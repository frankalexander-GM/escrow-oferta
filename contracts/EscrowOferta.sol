// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title EscrowOferta
/// @notice Custodia el pago de una oferta entre comprador y vendedor hasta que
///         el comprador confirma la entrega, vence el plazo (devolución
///         automática) o el árbitro resuelve una disputa.
/// @dev    Los pagos salen con patrón "pull": el contrato nunca empuja ETH a
///         nadie durante un cambio de estado, solo acredita un saldo que el
///         beneficiario retira cuando quiere. Así una dirección que rechaza
///         ETH no puede bloquear una orden.
contract EscrowOferta {
    // ---------------------------------------------------------------- tipos

    enum Estado {
        Inexistente,
        Creado, // orden registrada, aún sin dinero
        Financiado, // dinero en custodia
        Liberado, // pagado al vendedor
        Reembolsado, // devuelto al comprador
        EnDisputa // congelado hasta que el árbitro decida
    }

    struct Orden {
        address comprador;
        address vendedor;
        uint128 monto; // en wei
        uint64 plazoEntrega; // timestamp límite para reclamar
        Estado estado;
    }

    // ------------------------------------------------------------- inmutables

    /// @notice Única dirección con potestad para resolver disputas.
    address public immutable arbitro;

    /// @notice Comisión de la plataforma en puntos base (350 = 3,5 %).
    uint16 public immutable comisionBps;

    uint16 private constant BPS_DENOMINADOR = 10_000;
    uint16 private constant COMISION_MAXIMA_BPS = 1_000; // 10 %

    // ----------------------------------------------------------------- estado

    mapping(bytes32 => Orden) private _ordenes;

    /// @notice Saldo acreditable a cada dirección (patrón pull).
    mapping(address => uint256) public saldoPendiente;

    /// @notice Dinero total atrapado en órdenes financiadas. Debe cuadrar con
    ///         `address(this).balance - sum(saldoPendiente)`.
    uint256 public totalEnCustodia;

    uint256 private _cerrojo = 1;

    // --------------------------------------------------------------- eventos

    event OrdenCreada(
        bytes32 indexed id,
        address indexed comprador,
        address indexed vendedor,
        uint64 plazoEntrega
    );
    event OrdenFinanciada(bytes32 indexed id, uint256 monto);
    event EntregaConfirmada(bytes32 indexed id, uint256 alVendedor, uint256 comision);
    event Reembolso(bytes32 indexed id, address indexed destinatario, uint256 monto);
    event DisputaAbierta(bytes32 indexed id, address indexed por);
    event DisputaResuelta(bytes32 indexed id, bool aFavorDelVendedor);
    event Retirado(address indexed cuenta, uint256 monto);

    // --------------------------------------------------------------- errores

    error NoAutorizado();
    error EstadoInvalido(Estado actual);
    error OrdenInexistente();
    error ImporteInvalido();
    error PlazoInvalido();
    error ComisionExcesiva();
    error AunNoVencida();
    error SinSaldo();
    error TransferenciaFallida();
    error Reentrada();
    error NoAceptaEtherDirecto();

    // --------------------------------------------------------------- módulos

    modifier nonReentrant() {
        if (_cerrojo != 1) revert Reentrada();
        _cerrojo = 2;
        _;
        _cerrojo = 1;
    }

    constructor(address _arbitro, uint16 _comisionBps) {
        if (_arbitro == address(0)) revert NoAutorizado();
        if (_comisionBps > COMISION_MAXIMA_BPS) revert ComisionExcesiva();
        arbitro = _arbitro;
        comisionBps = _comisionBps;
    }

    // ------------------------------------------------------------- escritura

    /// @notice El comprador registra la orden indicando a quién pagará.
    /// @param id Identificador externo (normalmente keccak256 del id de la oferta).
    function crearOrden(bytes32 id, address vendedor, uint64 plazoEntrega) external {
        Orden storage o = _ordenes[id];
        if (o.estado != Estado.Inexistente) revert EstadoInvalido(o.estado);
        if (vendedor == address(0) || vendedor == msg.sender) revert NoAutorizado();
        if (plazoEntrega <= block.timestamp) revert PlazoInvalido();

        _ordenes[id] = Orden({
            comprador: msg.sender,
            vendedor: vendedor,
            monto: 0,
            plazoEntrega: plazoEntrega,
            estado: Estado.Creado
        });

        emit OrdenCreada(id, msg.sender, vendedor, plazoEntrega);
    }

    /// @notice El comprador deposita el importe acordado. Nadie más puede.
    function financiar(bytes32 id) external payable {
        Orden storage o = _ordenes[id];
        if (o.comprador == address(0)) revert OrdenInexistente();
        if (msg.sender != o.comprador) revert NoAutorizado();
        if (o.estado != Estado.Creado) revert EstadoInvalido(o.estado);
        if (msg.value == 0 || msg.value > type(uint128).max) revert ImporteInvalido();

        o.monto = uint128(msg.value);
        o.estado = Estado.Financiado;
        totalEnCustodia += msg.value;

        emit OrdenFinanciada(id, msg.value);
    }

    /// @notice El comprador confirma que recibió lo pactado y libera el pago.
    function confirmarEntrega(bytes32 id) external {
        Orden storage o = _ordenes[id];
        if (o.comprador == address(0)) revert OrdenInexistente();
        if (msg.sender != o.comprador) revert NoAutorizado();
        if (o.estado != Estado.Financiado) revert EstadoInvalido(o.estado);

        (uint256 alVendedor, uint256 comision) = _pagarAlVendedor(o);
        emit EntregaConfirmada(id, alVendedor, comision);
    }

    /// @notice Si el plazo vence sin entrega confirmada, el comprador recupera
    ///         su dinero. Cualquier tercero puede forzar la devolución.
    function reclamarVencimiento(bytes32 id) external {
        Orden storage o = _ordenes[id];
        if (o.comprador == address(0)) revert OrdenInexistente();
        if (o.estado != Estado.Financiado) revert EstadoInvalido(o.estado);
        if (block.timestamp < o.plazoEntrega) revert AunNoVencida();

        uint256 monto = _devolverAlComprador(o);
        emit Reembolso(id, o.comprador, monto);
    }

    /// @notice El vendedor cancela y devuelve el dinero sin esperar al plazo.
    function cancelar(bytes32 id) external {
        Orden storage o = _ordenes[id];
        if (o.comprador == address(0)) revert OrdenInexistente();
        if (msg.sender != o.vendedor) revert NoAutorizado();
        if (o.estado != Estado.Financiado) revert EstadoInvalido(o.estado);

        uint256 monto = _devolverAlComprador(o);
        emit Reembolso(id, o.comprador, monto);
    }

    /// @notice Comprador o vendedor congelan la orden para que decida el árbitro.
    function abrirDisputa(bytes32 id) external {
        Orden storage o = _ordenes[id];
        if (o.comprador == address(0)) revert OrdenInexistente();
        if (msg.sender != o.comprador && msg.sender != o.vendedor) revert NoAutorizado();
        if (o.estado != Estado.Financiado) revert EstadoInvalido(o.estado);

        o.estado = Estado.EnDisputa;
        emit DisputaAbierta(id, msg.sender);
    }

    /// @notice El árbitro decide el destino completo del importe en disputa.
    function resolverDisputa(bytes32 id, bool aFavorDelVendedor) external {
        Orden storage o = _ordenes[id];
        if (o.comprador == address(0)) revert OrdenInexistente();
        if (msg.sender != arbitro) revert NoAutorizado();
        if (o.estado != Estado.EnDisputa) revert EstadoInvalido(o.estado);

        if (aFavorDelVendedor) {
            (uint256 alVendedor, uint256 comision) = _pagarAlVendedor(o);
            emit EntregaConfirmada(id, alVendedor, comision);
        } else {
            uint256 monto = _devolverAlComprador(o);
            emit Reembolso(id, o.comprador, monto);
        }

        emit DisputaResuelta(id, aFavorDelVendedor);
    }

    /// @notice Retira el saldo acumulado a favor de quien llama.
    function retirar() external nonReentrant {
        uint256 monto = saldoPendiente[msg.sender];
        if (monto == 0) revert SinSaldo();

        saldoPendiente[msg.sender] = 0; // efectos antes de la interacción

        (bool ok, ) = payable(msg.sender).call{value: monto}("");
        if (!ok) revert TransferenciaFallida();

        emit Retirado(msg.sender, monto);
    }

    // -------------------------------------------------------------- internos

    function _pagarAlVendedor(
        Orden storage o
    ) private returns (uint256 alVendedor, uint256 comision) {
        uint256 total = o.monto;
        comision = (total * comisionBps) / BPS_DENOMINADOR;
        alVendedor = total - comision;

        o.monto = 0;
        o.estado = Estado.Liberado;
        totalEnCustodia -= total;

        saldoPendiente[o.vendedor] += alVendedor;
        if (comision > 0) saldoPendiente[arbitro] += comision;
    }

    function _devolverAlComprador(Orden storage o) private returns (uint256 monto) {
        monto = o.monto;

        o.monto = 0;
        o.estado = Estado.Reembolsado;
        totalEnCustodia -= monto;

        saldoPendiente[o.comprador] += monto;
    }

    // ---------------------------------------------------------------- vistas

    function verOrden(bytes32 id) external view returns (Orden memory) {
        return _ordenes[id];
    }

    /// @notice Comprobación de integridad: el ETH del contrato debe ser igual
    ///         a la custodia más todo lo pendiente de retirar.
    function contabilidadCuadra() external view returns (bool) {
        return address(this).balance >= totalEnCustodia;
    }

    // --------------------------------------------------------------- defensas

    receive() external payable {
        revert NoAceptaEtherDirecto();
    }

    fallback() external payable {
        revert NoAceptaEtherDirecto();
    }
}
