import type { MessageModule } from './types';

// The camera that reads barcodes. Read at arm's length, next to a truck,
// sometimes with gloves on: every sentence says what to do next, and the
// blocked-camera one says exactly where the switch is, because "allow the
// camera" alone sends people hunting through every setting on the phone.
export const scanner: MessageModule = {
  en: {
    'scanner.region': 'Barcode camera',
    'scanner.close': 'Close the camera',
    'scanner.torch': 'Light',
    'scanner.starting': 'Opening the camera…',
    'scanner.preparing': 'Getting the code reader ready…',
    'scanner.scanning': 'Point at a barcode, inside the frame.',
    'scanner.scanningOnce': 'Point at the barcode. The camera closes once it reads it.',
    'scanner.read': 'Read {code}',
    'scanner.tapToStart': 'Tap to turn on the camera',
    'scanner.retry': 'Try again',
    'scanner.problem.denied': 'The camera is blocked for this site.',
    'scanner.problem.denied.help':
      'Allow it and try again. On Android: the icon to the left of the address › Permissions › Camera. On iPhone: “aA” next to the address › Website Settings › Camera.',
    'scanner.problem.insecure': 'The camera only works over a secure connection (https).',
    'scanner.problem.unsupported': 'This browser can’t use the camera. Type the code or use a scanner gun.',
    'scanner.problem.noCamera': 'No camera found on this device.',
    'scanner.problem.busy': 'Another app is using the camera. Close it and try again.',
    'scanner.problem.ended': 'The camera stopped.',
    'scanner.problem.reader': 'Couldn’t load the code reader. Check the connection and try again.',
    'scanner.problem.error': 'The camera didn’t start.',
  },
  es: {
    'scanner.region': 'Cámara para leer códigos',
    'scanner.close': 'Cerrar la cámara',
    'scanner.torch': 'Linterna',
    'scanner.starting': 'Abriendo la cámara…',
    'scanner.preparing': 'Preparando el lector de códigos…',
    'scanner.scanning': 'Apunta al código de barras, dentro del recuadro.',
    'scanner.scanningOnce': 'Apunta al código. La cámara se cierra al leerlo.',
    'scanner.read': 'Leído {code}',
    'scanner.tapToStart': 'Toca para encender la cámara',
    'scanner.retry': 'Reintentar',
    'scanner.problem.denied': 'La cámara está bloqueada para esta web.',
    'scanner.problem.denied.help':
      'Permítela y vuelve a intentarlo. En Android: el icono a la izquierda de la dirección › Permisos › Cámara. En iPhone: «aA» junto a la dirección › Ajustes del sitio web › Cámara.',
    'scanner.problem.insecure': 'La cámara solo funciona con conexión segura (https).',
    'scanner.problem.unsupported': 'Este navegador no puede usar la cámara. Escribe el código o usa la pistola.',
    'scanner.problem.noCamera': 'No hay ninguna cámara en este dispositivo.',
    'scanner.problem.busy': 'Otra app está usando la cámara. Ciérrala y vuelve a intentarlo.',
    'scanner.problem.ended': 'La cámara se ha detenido.',
    'scanner.problem.reader': 'No se pudo cargar el lector de códigos. Revisa la conexión y vuelve a intentarlo.',
    'scanner.problem.error': 'La cámara no ha arrancado.',
  },
};
