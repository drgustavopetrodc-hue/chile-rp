import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calcularDuracionMs,
  construirInformeServicioStaff,
  formatearDuracion,
  parsearIdsDiscord,
} from './servicio-staff-modelo'

test('formatea duraciones y no permite tiempo negativo', () => {
  assert.equal(formatearDuracion(3_661_999), '1 h 01 min 01 s')
  assert.equal(calcularDuracionMs(new Date(10_000), new Date(9_000)), 0)
})

test('acepta IDs y menciones de usuario, pero rechaza menciones de rol', () => {
  assert.deepEqual(
    parsearIdsDiscord('<@12345678901234567>, 12345678901234568'),
    ['12345678901234567', '12345678901234568'],
  )
  assert.throws(() => parsearIdsDiscord('<@&12345678901234567>'), /no es un ID/)
})

test('construye el informe con soportes, duraciones y referencias de grabación', () => {
  const inicio = new Date('2026-01-02T12:00:00.000Z')
  const soporte = new Date('2026-01-02T12:10:00.000Z')
  const finSoporte = new Date('2026-01-02T12:20:00.000Z')
  const informe = construirInformeServicioStaff({
    nombre: 'Staff',
    discordId: '12345678901234567',
    iniciadoEn: inicio,
    finalizadoEn: new Date('2026-01-02T13:00:00.000Z'),
    actividades: [{
      tipo: 'SOPORTE',
      titulo: 'Soporte institucional',
      detalle: 'Canal de voz: canal-1',
      iniciadoEn: soporte,
      finalizadoEn: finSoporte,
      duracionMs: 600_000n,
      soporteId: 'soporte-1',
      resultado: 'CERRADO',
    }],
    grabaciones: [{
      grabacionId: 'grabacion-1',
      origen: 'SOPORTE',
      estado: 'FINALIZADA',
    }],
  })

  assert.match(informe.resumen, /Soportes atendidos:\*\* 1/)
  assert.match(informe.actividades, /soporte-1/)
  assert.match(informe.actividades, /10 min/)
  assert.match(informe.actividades, /CERRADO/)
  assert.match(informe.grabaciones, /grabacion-1/)
  assert.equal(informe.estado, 'Servicio finalizado correctamente.')
})
