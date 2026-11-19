import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectarCierreDeterminista,
  detectarReasignacionDeterminista,
  destinoExplicitoUnico,
  ErrorOperacionReasignacion,
  esMencionActivadora,
  ejecutarReasignacionConRollback,
  parsearClasificacionAccionTicket,
  puedeReasignarTicket,
  puedeUsarClasificacionIA,
  validarPrecondicionesReasignacion,
} from './acciones-ticket'
import type { EquipoTicketAccion } from './acciones-ticket'

test('el respaldo determinista reconoce todos los equipos y transferencias requeridas', () => {
  const ejemplos: [string, EquipoTicketAccion][] = [
    ['Reasigna el ticket a Soporte', 'SOPORTE'],
    ['Deriva el caso a Moderación', 'MODERACION'],
    ['Pasa este ticket a Fundación', 'FUNDACION'],
    ['Transfiere el ticket a Junta Administrativa', 'JUNTA_ADMINISTRATIVA'],
    ['Devuelve el ticket a Soporte', 'SOPORTE'],
  ]
  for (const [texto, equipo] of ejemplos) {
    assert.deepEqual(detectarReasignacionDeterminista(texto), {
      accion: 'REASIGNAR',
      destino: equipo,
      ordenExplicita: true,
      ambigua: false,
    })
  }
  assert.equal(
    detectarReasignacionDeterminista('Reasigna el ticket desde Soporte a Moderación')?.destino,
    'MODERACION',
  )

  const transferencias: [EquipoTicketAccion, EquipoTicketAccion][] = [
    ['SOPORTE', 'MODERACION'],
    ['MODERACION', 'FUNDACION'],
    ['FUNDACION', 'JUNTA_ADMINISTRATIVA'],
    ['MODERACION', 'SOPORTE'],
  ]
  for (const [equipoActual, equipoNuevo] of transferencias) {
    assert.notEqual(equipoActual, equipoNuevo)
    assert.equal(validarPrecondicionesReasignacion({
      estado: 'EN_ATENCION',
      equipoActual,
      equipoNuevo,
      rolActualExiste: true,
      rolNuevoExiste: true,
      botPuedeGestionarPermisos: true,
    }), undefined)
  }
})

test('no ejecuta citas, preguntas, negaciones ni instrucciones dirigidas a otras personas', () => {
  assert.equal(detectarReasignacionDeterminista('> Reasigna el ticket a Soporte'), undefined)
  assert.equal(detectarReasignacionDeterminista('El usuario dijo "Reasigna el ticket a Soporte"'), undefined)
  assert.equal(detectarReasignacionDeterminista("El usuario dijo 'Reasigna el ticket a Soporte'"), undefined)
  assert.equal(detectarReasignacionDeterminista('¿Cómo reasigno el ticket a Soporte?'), undefined)
  assert.equal(detectarReasignacionDeterminista('No reasignes el ticket a Soporte'), undefined)
  assert.equal(detectarCierreDeterminista('`Cierra el ticket`'), false)
  assert.equal(detectarCierreDeterminista('No cierres el ticket'), false)
  assert.equal(detectarReasignacionDeterminista('Reasigna el ticket a Soporte o Moderación')?.ambigua, true)
  assert.equal(detectarReasignacionDeterminista('Reasigna el ticket a Legal')?.destino, null)
})

test('valida la estructura IA y el destino explícito literal', () => {
  assert.deepEqual(parsearClasificacionAccionTicket(
    '{"accion":"REASIGNAR","destino":"SOPORTE","ordenExplicita":true,"ambigua":false}',
  ), {
    accion: 'REASIGNAR',
    destino: 'SOPORTE',
    ordenExplicita: true,
    ambigua: false,
  })
  assert.equal(parsearClasificacionAccionTicket(
    '{"accion":"REASIGNAR","destino":"ADMIN","ordenExplicita":true,"ambigua":false}',
  ), undefined)
  assert.equal(parsearClasificacionAccionTicket(
    '{"accion":"REASIGNAR","destino":"SOPORTE","ordenExplicita":false,"ambigua":false}',
  )?.ordenExplicita, false)
  assert.equal(destinoExplicitoUnico('Reasigna el caso a Junta Administrativa', 'JUNTA_ADMINISTRATIVA'), true)
  assert.equal(destinoExplicitoUnico('Reasigna el caso a Soporte', 'MODERACION'), false)
  assert.equal(destinoExplicitoUnico('Cambia el ticket de Soporte a Moderación', 'MODERACION'), true)
  assert.equal(destinoExplicitoUnico('Cambia el ticket a Soporte o Moderación', 'SOPORTE'), false)
})

test('la IA desactivada conserva el respaldo determinista y omite la llamada IA', () => {
  assert.equal(puedeUsarClasificacionIA(false, true), false)
  assert.equal(puedeUsarClasificacionIA(true, false), false)
  assert.equal(puedeUsarClasificacionIA(undefined, true), true)
  assert.equal(detectarReasignacionDeterminista('Reasigna el ticket a Soporte')?.destino, 'SOPORTE')
})

test('solo activa la acción una mención final al bot correcto', () => {
  assert.equal(esMencionActivadora('Reasigna el ticket a Soporte <@123>', '123', ['123']), true)
  assert.equal(esMencionActivadora('Reasigna el ticket a Soporte <@!123>', '123', ['123']), true)
  assert.equal(esMencionActivadora('Reasigna el ticket a Soporte <@456>', '123', ['456']), false)
  assert.equal(esMencionActivadora('Reasigna <@123> a Soporte <@456>', '123', ['123', '456']), false)
  assert.equal(esMencionActivadora('Reasigna el ticket a Soporte', '123', []), false)
})

test('solo reasigna el equipo actual, administradores o autoridades autorizadas', () => {
  assert.equal(puedeReasignarTicket(['rol-soporte'], 'rol-soporte', [], false), true)
  assert.equal(puedeReasignarTicket(['rol-jugador'], 'rol-soporte', [], false), false)
  assert.equal(puedeReasignarTicket(['rol-fundacion'], 'rol-soporte', ['rol-fundacion'], false), true)
  assert.equal(puedeReasignarTicket(['rol-jugador'], 'rol-soporte', [], true), true)
})

test('rechaza destino inexistente, equipo sin rol y permisos insuficientes del bot', () => {
  const base = {
    estado: 'EN_ATENCION',
    equipoActual: 'SOPORTE' as const,
    equipoNuevo: 'MODERACION' as const,
    rolActualExiste: true,
    rolNuevoExiste: false,
    botPuedeGestionarPermisos: true,
  }
  assert.match(validarPrecondicionesReasignacion(base) ?? '', /rol del equipo de destino/)
  assert.match(validarPrecondicionesReasignacion({
    ...base,
    rolNuevoExiste: true,
    botPuedeGestionarPermisos: false,
  }) ?? '', /Gestionar roles/)
  assert.match(validarPrecondicionesReasignacion({
    ...base,
    equipoActual: null,
    rolActualExiste: false,
  }) ?? '', /equipo responsable actual/)
})

test('el rollback restaura primero el equipo actual, el registro y finalmente el destino', async () => {
  const llamadas: string[] = []
  await assert.rejects(ejecutarReasignacionConRollback({
    concederDestino: async () => { llamadas.push('conceder-nuevo') },
    retirarEquipoActual: async () => { llamadas.push('retirar-actual') },
    actualizarRegistro: async () => {
      llamadas.push('actualizar-db')
      throw new Error('fallo simulado')
    },
    restaurarEquipoActual: async () => { llamadas.push('restaurar-actual') },
    restaurarRegistro: async () => { llamadas.push('restaurar-db') },
    restaurarDestino: async () => { llamadas.push('restaurar-destino') },
    mantenerDestinoResponsable: async () => { llamadas.push('mantener-destino') },
  }), (error: unknown) => {
    assert.ok(error instanceof ErrorOperacionReasignacion)
    assert.equal(error.resultado, 'REVERTIDA')
    return true
  })

  test('una reasignación sin fallos concede, retira y persiste en ese orden', async () => {
    const llamadas: string[] = []
    await ejecutarReasignacionConRollback({
      concederDestino: async () => { llamadas.push('conceder-nuevo') },
      retirarEquipoActual: async () => { llamadas.push('retirar-actual') },
      actualizarRegistro: async () => { llamadas.push('actualizar-db') },
      restaurarEquipoActual: async () => { llamadas.push('restaurar-actual') },
      restaurarRegistro: async () => { llamadas.push('restaurar-db') },
      restaurarDestino: async () => { llamadas.push('restaurar-destino') },
      mantenerDestinoResponsable: async () => { llamadas.push('mantener-destino') },
    })
    assert.deepEqual(llamadas, ['conceder-nuevo', 'retirar-actual', 'actualizar-db'])
  })
  assert.deepEqual(llamadas, [
    'conceder-nuevo',
    'retirar-actual',
    'actualizar-db',
    'restaurar-actual',
    'restaurar-db',
    'restaurar-destino',
  ])
})

test('si falla la restauración del equipo actual mantiene el destino accesible', async () => {
  const llamadas: string[] = []
  await assert.rejects(ejecutarReasignacionConRollback({
    concederDestino: async () => { llamadas.push('conceder-nuevo') },
    retirarEquipoActual: async () => { llamadas.push('retirar-actual') },
    actualizarRegistro: async () => { throw new Error('fallo de base de datos') },
    restaurarEquipoActual: async () => {
      llamadas.push('restaurar-actual')
      throw new Error('fallo de permisos')
    },
    restaurarRegistro: async () => { llamadas.push('restaurar-db') },
    restaurarDestino: async () => { llamadas.push('restaurar-destino') },
    mantenerDestinoResponsable: async () => { llamadas.push('mantener-destino') },
  }), (error: unknown) => {
    assert.ok(error instanceof ErrorOperacionReasignacion)
    assert.equal(error.resultado, 'FALLIDA')
    return true
  })
  assert.deepEqual(llamadas, ['conceder-nuevo', 'retirar-actual', 'restaurar-actual', 'mantener-destino'])
})
