import type { MessageModule } from './types';

export const common: MessageModule = {
  en: {
    // Fields shared by the sign-in and sign-up forms.
    'common.field.email': 'Email',
    'common.field.password': 'Password',

    'common.login.title': 'Sign in to ShiftPlanner',
    'common.login.subtitle': 'Welcome back.',
    'common.login.submit': 'Sign in',
    'common.login.submitting': 'Signing in…',
    'common.login.noAccount': 'No account?',
    'common.login.createOrg': 'Create an organization',
    // Above the form, when the server closed the session this tab had open.
    'common.login.sessionEnded': 'You were signed out. Sign in again.',

    'common.signup.title': 'Create your organization',
    'common.signup.subtitle': 'You become the manager (owner) of a new workspace.',
    'common.signup.orgName': 'Organization name',
    'common.signup.fullName': 'Your full name',
    'common.signup.submit': 'Create organization',
    'common.signup.submitting': 'Creating…',
    'common.signup.haveAccount': 'Already have an account?',
    'common.signup.signIn': 'Sign in',

    'common.modal.close': 'Close',

    'common.spinner.loading': 'Loading…',

    'common.error.generic': 'Something went wrong',
  },
  es: {
    // Fields shared by the sign-in and sign-up forms.
    'common.field.email': 'Email',
    'common.field.password': 'Contraseña',

    'common.login.title': 'Inicia sesión en ShiftPlanner',
    'common.login.subtitle': 'Nos alegra verte de nuevo.',
    'common.login.submit': 'Iniciar sesión',
    'common.login.submitting': 'Iniciando sesión…',
    'common.login.noAccount': '¿No tienes cuenta?',
    'common.login.createOrg': 'Crea una organización',
    // Sobre el formulario, cuando el servidor cerró la sesión que tenía esta pestaña.
    'common.login.sessionEnded': 'Se cerró la sesión. Vuelve a entrar.',

    'common.signup.title': 'Crea tu organización',
    'common.signup.subtitle': 'Te conviertes en el responsable (propietario) de un espacio de trabajo nuevo.',
    'common.signup.orgName': 'Nombre de la organización',
    'common.signup.fullName': 'Tu nombre completo',
    'common.signup.submit': 'Crear organización',
    'common.signup.submitting': 'Creando…',
    'common.signup.haveAccount': '¿Ya tienes cuenta?',
    'common.signup.signIn': 'Iniciar sesión',

    'common.modal.close': 'Cerrar',

    'common.spinner.loading': 'Cargando…',

    'common.error.generic': 'Algo ha salido mal',
  },
};
