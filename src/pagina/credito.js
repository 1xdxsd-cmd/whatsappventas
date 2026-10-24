// Cobro con el crédito (saldo prepago) que el cliente tiene en la página.
// Hace lo mismo que la compra y la renovación con saldo del portal de la
// página, pero desde el bot, con la cuenta de administrador.
//
// Orden pensado para que un fallo nunca entregue sin cobrar ni cobre dos veces:
// 1. Descontar el crédito (la página rechaza si no alcanza).
// 2. Crear o extender la renta. Si falla, se devuelve el crédito.
// 3. Registrar la venta (si falla, solo se avisa: el dinero ya está bien).
// Los cobros van de uno en uno para que dos compras no tomen el mismo cupo.

const DIA = 864e5;

export function fechaMexico(ahora = new Date()) {
  return new Date(ahora.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
}

export function sumarDias(fecha, dias) {
  return new Date(Date.parse(fecha) + dias * DIA).toISOString().slice(0, 10);
}

// Igual que la página: una cuenta designada al mismo tipo de venta, no
// suspendida y con cupo (cuenta completa = 1 cupo, perfil = sus perfiles).
export function elegirCuenta(cuentas, servicio) {
  const tipo = servicio.type === 'cuenta' ? 'cuenta' : 'perfil';
  return (
    cuentas.find((c) => {
      if (c.platform !== servicio.platform || c.suspended) return false;
      if ((c.saleType || 'perfil') !== tipo) return false;
      const cupo = c.capacity ?? (c.saleType === 'cuenta' ? 1 : c.totalProfiles || 1);
      return (c.usedProfiles ?? 0) < cupo;
    }) ?? null
  );
}

export function crearCobrosConCredito({ pagina, logger, ahora = () => new Date() }) {
  let cola = Promise.resolve();

  function enOrden(tarea) {
    const resultado = cola.then(tarea);
    cola = resultado.catch(() => {});
    return resultado;
  }

  async function devolver(cliente, precio, resumen) {
    try {
      await pagina.ajustarSaldo(cliente.id, precio, `Reembolso automático (WhatsApp): ${resumen}`);
      return 'reembolsado';
    } catch (error) {
      logger?.error({ err: error, cliente: cliente.id }, 'No se pudo devolver el crédito');
      return 'sinReembolso';
    }
  }

  /**
   * @param {{ cliente: { id: string, nombre: string }, servicio: object, resumen: string, renta?: object }} pedido
   */
  function pagar({ cliente, servicio, resumen, renta }) {
    return enOrden(async () => {
      const precio = Number(servicio.price) || 0;
      const duracion = Number(servicio.duration) || 30;

      let saldo;
      try {
        saldo = (await pagina.ajustarSaldo(cliente.id, -precio, `${renta ? 'Renovación' : 'Compra'} por WhatsApp: ${resumen}`)).balance;
      } catch (error) {
        if (error.estado === 400) return { ok: false, motivo: 'saldoInsuficiente' };
        // No se sabe si la página alcanzó a descontar: que lo revise una persona.
        logger?.error({ err: error, cliente: cliente.id }, 'Falló el descuento de crédito');
        return { ok: false, motivo: 'descuentoIncierto' };
      }

      const hoy = fechaMexico(ahora());
      let cuenta = null;
      let fechaFin;
      try {
        if (renta) {
          // Desde el vencimiento actual si aún no vence, o desde hoy.
          const vence = String(renta.endDate).slice(0, 10);
          fechaFin = sumarDias(vence > hoy ? vence : hoy, duracion);
          await pagina.actualizarRenta(renta.id, { endDate: fechaFin, status: 'activa' });
        } else {
          cuenta = elegirCuenta(await pagina.cuentas(), servicio);
          fechaFin = sumarDias(hoy, duracion);
          const nueva = await pagina.crearRenta({
            clientId: cliente.id,
            clientName: cliente.nombre,
            email: cuenta?.email ?? '',
            platform: servicio.platform,
            type: servicio.type,
            price: precio,
            startDate: hoy,
            endDate: fechaFin,
            accountId: cuenta?.id ?? null,
          });
          // Sin cuenta disponible, queda en "entregas pendientes" del panel.
          if (!cuenta) await pagina.actualizarRenta(nueva.id, { needsSetup: true, source: 'saldo' }).catch(() => {});
        }
      } catch (error) {
        logger?.error({ err: error, cliente: cliente.id }, 'Falló la entrega después de cobrar; devolviendo crédito');
        return { ok: false, motivo: await devolver(cliente, precio, resumen) };
      } finally {
        pagina.olvidarCache();
      }

      let ventaRegistrada = true;
      try {
        await pagina.registrarVenta({
          clientName: cliente.nombre,
          platform: servicio.platform,
          type: servicio.type,
          price: precio,
          paymentMethod: 'saldo',
          notes: `${renta ? 'Renovación' : 'Compra'} con saldo por WhatsApp`,
        });
      } catch (error) {
        ventaRegistrada = false;
        logger?.warn({ err: error }, 'No se pudo registrar la venta');
      }

      return { ok: true, saldo, cuenta, fechaFin, renovacion: Boolean(renta), ventaRegistrada };
    });
  }

  return { pagar };
}
