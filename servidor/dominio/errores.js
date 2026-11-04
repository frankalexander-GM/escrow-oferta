/**
 * Errores de la aplicación. El dominio y los servicios lanzan ErrorAplicacion
 * con el código HTTP que le corresponde; la capa HTTP solo traduce.
 */
class ErrorAplicacion extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.name = "ErrorAplicacion";
    this.status = status;
  }
}

/** Extrae el nombre del error personalizado del contrato si existe. */
function mensajeDeError(error) {
  if (error?.revert?.name) return error.revert.name;
  if (error?.shortMessage) return error.shortMessage;
  return error?.message || "Error desconocido";
}

function statusDeError(error) {
  if (error instanceof ErrorAplicacion) return error.status;
  if (error?.revert) return 400;
  return 500;
}

module.exports = { ErrorAplicacion, mensajeDeError, statusDeError };
