import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js'
import { comoComponentsV2 } from './components-v2'
import {
  crearPermisosCanalSoporte,
  normalizarSufijoCanalSoporte,
  obtenerIdsAccesoSoporte,
  obtenerIdsUsuariosParaMover,
  puedeEliminarTrasRetirarConsentimiento,
  puedeIniciarSoporte,
  validarParticipantesSoporte,
} from './soporte'

const grupoVacio = { usuarios: [] }

test('exige reportantes y reportados, pero permite omitir testigos', () => {
  assert.match(
    validarParticipantesSoporte({
      reportantes: grupoVacio,
      reportados: grupoVacio,
      testigos: grupoVacio,
    }) ?? '',
    /Personas que reportan/,
  )

  assert.equal(validarParticipantesSoporte({
    reportantes: { usuarios: ['100000000000000001'] },
    reportados: { rolId: '200000000000000002', usuarios: [] },
    testigos: grupoVacio,
  }), undefined)
})

test('limita cada selección a tres usuarios y no mezcla usuarios con rol', () => {
  const tresUsuarios = ['100000000000000001', '100000000000000002', '100000000000000003']
  assert.equal(validarParticipantesSoporte({
    reportantes: { usuarios: tresUsuarios },
    reportados: { usuarios: ['200000000000000001'] },
    testigos: { usuarios: tresUsuarios },
  }), undefined)

  assert.match(validarParticipantesSoporte({
    reportantes: { usuarios: [...tresUsuarios, '100000000000000004'] },
    reportados: { usuarios: ['200000000000000001'] },
    testigos: grupoVacio,
  }) ?? '', /máximo tres/)

  assert.match(validarParticipantesSoporte({
    reportantes: { usuarios: ['100000000000000001'], rolId: '100000000000000002' },
    reportados: { usuarios: ['200000000000000001'] },
    testigos: grupoVacio,
  }) ?? '', /usuarios o un rol/)
})

test('testigos no admiten roles y tampoco se pueden duplicar', () => {
  assert.match(validarParticipantesSoporte({
    reportantes: { usuarios: ['100000000000000001'] },
    reportados: { usuarios: ['200000000000000001'] },
    testigos: { usuarios: [], rolId: '300000000000000001' },
  }) ?? '', /Testigos: no se permite seleccionar un rol/)

  assert.match(validarParticipantesSoporte({
    reportantes: { usuarios: ['100000000000000001'] },
    reportados: { usuarios: ['200000000000000001'] },
    testigos: { usuarios: ['300000000000000001', '300000000000000001'] },
  }) ?? '', /no se pueden repetir/)
})

test('normaliza el sufijo del canal sin caracteres incompatibles', () => {
  assert.equal(normalizarSufijoCanalSoporte('  José Pérez / 01  '), 'jose-perez-01')
  assert.equal(normalizarSufijoCanalSoporte('!!!'), 'usuario')
})

test('consolida identidades repetidas y conserva roles y ejecutor', () => {
  assert.deepEqual(obtenerIdsAccesoSoporte({
    reportantes: { usuarios: ['100000000000000001'], rolId: undefined },
    reportados: { usuarios: ['100000000000000001'], rolId: undefined },
    testigos: { usuarios: ['300000000000000001'], rolId: undefined },
  }, '400000000000000001', ['500000000000000001', '500000000000000001']), [
    '100000000000000001',
    '300000000000000001',
    '400000000000000001',
    '500000000000000001',
  ])
})

test('incluye al moderador responsable al mover usuarios y elimina duplicados', () => {
  assert.deepEqual(obtenerIdsUsuariosParaMover({
    reportantes: { usuarios: ['100000000000000001', '400000000000000001'] },
    reportados: { usuarios: ['200000000000000001'] },
    testigos: { usuarios: ['300000000000000001'] },
  }, '400000000000000001'), [
    '100000000000000001',
    '400000000000000001',
    '200000000000000001',
    '300000000000000001',
  ])
  assert.throws(() => obtenerIdsUsuariosParaMover({
    reportantes: { usuarios: [] },
    reportados: { usuarios: [] },
    testigos: { usuarios: [] },
  }, 'cmwh5kfan0000covjisvlxqwj'), /ID de Discord/)
})

test('solo permite eliminar canales tras registrar el retiro, cierre y logs de la grabación', () => {
  const canales = ['moderacion', 'administracion']
  assert.equal(puedeEliminarTrasRetirarConsentimiento(
    canales,
    canales,
    canales,
    canales,
    true,
  ), true)
  assert.equal(puedeEliminarTrasRetirarConsentimiento(
    canales,
    ['moderacion'],
    canales,
    canales,
    true,
  ), false)
  assert.equal(puedeEliminarTrasRetirarConsentimiento(
    canales,
    canales,
    canales,
    ['moderacion'],
    true,
  ), false)
  assert.equal(puedeEliminarTrasRetirarConsentimiento(
    canales,
    canales,
    canales,
    [],
    false,
  ), true)
})

test('convierte registros de soporte con archivos y botones en un container Components V2', () => {
  const payload = comoComponentsV2({
    content: 'Grabación finalizada.',
    files: [{ name: 'soporte-mezcla.ogg' }],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('soporte:acceder').setLabel('Acceder').setStyle(ButtonStyle.Primary),
      ),
    ],
  })

  assert.ok((payload.flags & MessageFlags.IsComponentsV2) !== 0)
  assert.ok(payload.components[0] instanceof ContainerBuilder)
  assert.equal(payload.components[0].toJSON().components.length, 3)
})

test('solo permite iniciar el soporte a staff, moderación, administración o administradores Discord', () => {
  const autorizados = { staff: 'staff-role', moderador: 'mod-role', admin: 'admin-role' }
  assert.equal(puedeIniciarSoporte(false, [], autorizados), false)
  assert.equal(puedeIniciarSoporte(false, ['mod-role'], autorizados), true)
  assert.equal(puedeIniciarSoporte(false, ['staff-role'], autorizados), true)
  assert.equal(puedeIniciarSoporte(false, ['admin-role'], autorizados), true)
  assert.equal(puedeIniciarSoporte(true, [], autorizados), true)
})

test('los overwrites de voz y evidencias niegan @everyone y comparten los mismos accesos', () => {
  const accesos = ['reporter-user', 'reported-role', 'witness-user', 'staff-role']
  const voz = crearPermisosCanalSoporte('everyone', 'bot', accesos, 'voz')
  const evidencias = crearPermisosCanalSoporte('everyone', 'bot', accesos, 'texto')
  const everyoneVoz = voz.find((overwrite) => overwrite.id === 'everyone')
  const everyoneTexto = evidencias.find((overwrite) => overwrite.id === 'everyone')

  assert.ok(everyoneVoz?.deny.includes(PermissionFlagsBits.ViewChannel))
  assert.ok(everyoneTexto?.deny.includes(PermissionFlagsBits.ViewChannel))
  assert.deepEqual(
    voz.map((overwrite) => overwrite.id).sort(),
    evidencias.map((overwrite) => overwrite.id).sort(),
  )

  const permisosTextoUsuario = evidencias.find((overwrite) => overwrite.id === 'reporter-user')
  const permisosBotVoz = voz.find((overwrite) => overwrite.id === 'bot')
  assert.ok(permisosTextoUsuario?.allow.includes(PermissionFlagsBits.AttachFiles))
  assert.ok(permisosTextoUsuario?.allow.includes(PermissionFlagsBits.EmbedLinks))
  assert.ok(permisosTextoUsuario?.allow.includes(PermissionFlagsBits.SendMessages))
  assert.ok(permisosBotVoz?.allow.includes(PermissionFlagsBits.MuteMembers))
  assert.ok(permisosBotVoz?.allow.includes(PermissionFlagsBits.MoveMembers))
  assert.ok(
    voz.find((overwrite) => overwrite.id === 'reporter-user')?.allow.includes(PermissionFlagsBits.Connect),
  )
})
