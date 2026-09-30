import type { MessageModule } from './types';

// The business assistant: a chat that answers about this business and
// remembers it. The privacy line is said up front, as in the interview: the
// names are replaced before anything leaves, and what it remembers can be read
// and deleted line by line.
export const assistant: MessageModule = {
  en: {
    'assistant.open': 'Ask the assistant',
    'assistant.title': 'Your business assistant',
    'assistant.close': 'Close',
    'assistant.new': 'New conversation',
    'assistant.intro':
      'Ask me about your calendar and your business: who works when, where the gaps are, what to write in the brief to change something. I only read; I never change anything myself.',
    'assistant.placeholder': 'Ask something',
    'assistant.send': 'Send',
    'assistant.thinking': 'Thinking…',
    'assistant.ended':
      'This conversation has reached its limit. The next message starts a new one, with everything I remember.',
    'assistant.privacy':
      'Names are replaced by pseudonyms before anything leaves ShiftPlanner; I never see pay, contracts or absences.',
    'assistant.memory.title': 'What the assistant remembers',
    'assistant.memory.help':
      'Short facts about your business it keeps for next time. It stores pseudonyms, not names; you see the names here. Delete anything you do not want it to keep.',
    'assistant.memory.empty': 'Nothing yet.',
    'assistant.memory.loading': 'Loading…',
    'assistant.memory.delete': 'Delete',
    'assistant.memory.deleteLine': 'Delete “{text}”',
    'assistant.memory.forgetAll': 'Forget everything',
    'assistant.memory.forgetAllConfirm':
      'Forget everything the assistant remembers about your business? This cannot be undone, and the current conversation ends.',
    'assistant.memory.forgetAllYes': 'Yes, forget everything',
    'assistant.memory.cancel': 'Cancel',
  },
  es: {
    'assistant.open': 'Pregunta al asistente',
    'assistant.title': 'El asistente de tu negocio',
    'assistant.close': 'Cerrar',
    'assistant.new': 'Nueva conversación',
    'assistant.intro':
      'Pregúntame por tu calendario y tu negocio: quién trabaja cuándo, dónde faltan manos, qué escribir en el brief para cambiar algo. Solo leo; nunca cambio nada yo.',
    'assistant.placeholder': 'Pregunta algo',
    'assistant.send': 'Enviar',
    'assistant.thinking': 'Pensando…',
    'assistant.ended':
      'Esta conversación ha llegado a su límite. El siguiente mensaje empieza una nueva, con todo lo que recuerdo.',
    'assistant.privacy':
      'Los nombres se cambian por seudónimos antes de salir de ShiftPlanner; nunca veo sueldos, contratos ni ausencias.',
    'assistant.memory.title': 'Lo que el asistente recuerda',
    'assistant.memory.help':
      'Datos cortos de tu negocio que guarda para la próxima vez. Guarda seudónimos, no nombres; aquí ves los nombres. Borra lo que no quieras que guarde.',
    'assistant.memory.empty': 'Nada todavía.',
    'assistant.memory.loading': 'Cargando…',
    'assistant.memory.delete': 'Borrar',
    'assistant.memory.deleteLine': 'Borrar «{text}»',
    'assistant.memory.forgetAll': 'Olvidarlo todo',
    'assistant.memory.forgetAllConfirm':
      '¿Olvidar todo lo que el asistente recuerda de tu negocio? No se puede deshacer, y la conversación actual termina.',
    'assistant.memory.forgetAllYes': 'Sí, olvidarlo todo',
    'assistant.memory.cancel': 'Cancelar',
  },
};
