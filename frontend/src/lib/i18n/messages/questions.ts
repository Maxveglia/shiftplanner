// The few questions worth interrupting a manager for.
//
// Its own module because it is its own idea, distinct from the two it sits
// between: a GAP is something nobody mentioned and a defensible number decided;
// a NOTE is something understood and inexpressible. A QUESTION is the residue
// of neither — a stretch of the brief we read perfectly and could turn into no
// number at all, where every value is a coin flip and a wrong one is invisible
// on the rota.
//
// The wording carries most of the design. It quotes the manager, because asking
// somebody about Saturdays right after they wrote a sentence about Saturdays
// reads as not having listened. And it says out loud that the calendar is
// already built, because a question that looks like a gate gets answered
// carelessly by people who just want their rota.

import type { MessageModule } from './types';

export const questions: MessageModule = {
  en: {
    'questions.title': 'One thing the rota cannot show us',
    'questions.dayHours.quoted':
      'You wrote "{quote}". What hours do you keep on {day}?',
    'questions.dayHours': 'What hours do you keep on {day}?',
    'questions.dayHours.opensAt': 'Opens at',
    'questions.dayHours.to': 'to',
    'questions.dayHours.closesAt': 'Closes at',
    'questions.dayHours.help':
      'Your calendar is already built — this only sharpens that day. Answer once and we will not ask again.',
    'questions.apply': 'Use this',
    'questions.dismiss': 'Not now',
    'questions.ruleLabel': '{day}, {from} to {to} — you told us',
  },
  es: {
    'questions.title': 'Lo único que el cuadrante no puede enseñarnos',
    'questions.dayHours.quoted':
      'Escribiste «{quote}». ¿Qué horario hacéis los {day}?',
    'questions.dayHours': '¿Qué horario hacéis los {day}?',
    'questions.dayHours.opensAt': 'Abre a las',
    'questions.dayHours.to': 'a',
    'questions.dayHours.closesAt': 'Cierra a las',
    'questions.dayHours.help':
      'Tu calendario ya está hecho: esto solo afina ese día. Contéstalo una vez y no volvemos a preguntarlo.',
    'questions.apply': 'Aplicar',
    'questions.dismiss': 'Ahora no',
    'questions.ruleLabel': '{day}, de {from} a {to} — nos lo dijiste tú',
  },
};
