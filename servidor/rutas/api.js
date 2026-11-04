/**
 * Capa de presentación HTTP: solo traduce request → caso de uso → JSON.
 * Ninguna regla de negocio vive aquí.
 */
const express = require("express");
const { mensajeDeError, statusDeError } = require("../dominio/errores");

function crearRouter(servicio) {
  const router = express.Router();

  const ruta = (fn) => async (req, res) => {
    try {
      const resultado = await fn(req, res);
      if (!res.headersSent) res.json(resultado);
    } catch (error) {
      console.error("[error]", mensajeDeError(error));
      res.status(statusDeError(error)).json({ error: mensajeDeError(error) });
    }
  };

  router.get(
    "/estado",
    ruta(() => servicio.estado())
  );

  router.post(
    "/ordenes",
    ruta((req) => servicio.crearOrden(req.body))
  );
  router.get(
    "/ordenes/:id",
    ruta((req) => servicio.consultarOrden(req.params.id))
  );
  router.post(
    "/ordenes/:id/financiar",
    ruta((req) => servicio.financiar(req.params.id, req.body))
  );

  for (const accion of ["confirmar", "cancelar", "reclamar", "disputa"]) {
    router.post(
      `/ordenes/:id/${accion}`,
      ruta((req) => servicio.ejecutarAccion(accion, req.params.id))
    );
  }

  router.post(
    "/ordenes/:id/resolver",
    ruta((req) => servicio.resolver(req.params.id, req.body))
  );
  router.post(
    "/retirar",
    ruta((req) => servicio.retirar(req.body))
  );

  return router;
}

module.exports = { crearRouter };
