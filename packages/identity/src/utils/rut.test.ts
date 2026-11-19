import assert from 'node:assert/strict'
import test from 'node:test'
import { calcularDv, generarNumeroSerie, generarRut } from './rut.js'

test('calcula el dígito verificador con módulo 11', () => {
  assert.equal(calcularDv(21_345_678), '4')
  assert.equal(calcularDv(18_000_000), '3')
  assert.equal(calcularDv(0), '0')
  assert.throws(() => calcularDv(-1), RangeError)
  assert.throws(() => calcularDv(1.5), RangeError)
})

test('genera RUT formateado dentro del rango conservado', () => {
  for (let intento = 0; intento < 100; intento++) {
    const rut = generarRut()
    assert.match(rut, /^((18|19|2[0-5])\.\d{3}\.\d{3})-[0-9K]$/)
    const cuerpo = Number(rut.split('-')[0].replace(/\./g, ''))
    assert.ok(cuerpo >= 18_000_000 && cuerpo < 26_000_000)
    assert.equal(rut.split('-')[1], calcularDv(cuerpo))
  }
})

test('genera números de serie de nueve dígitos en el rango conservado', () => {
  for (let intento = 0; intento < 100; intento++) {
    const serie = generarNumeroSerie()
    assert.match(serie, /^\d{9}$/)
    const numero = Number(serie)
    assert.ok(numero >= 100_000_000 && numero < 1_000_000_000)
  }
})
