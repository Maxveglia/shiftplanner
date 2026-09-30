-- ShiftPlanner Fase 0 -- creacion del rol de runtime restringido.
--
-- Este script lo ejecuta Postgres UNA sola vez, en la inicializacion del
-- cluster (cuando el volumen de datos esta vacio), via el directorio
-- /docker-entrypoint-initdb.d. Corre como superusuario 'postgres' sobre la
-- base de datos 'shiftplanner'.
--
-- Aqui SOLO creamos el rol app_user (NOSUPERUSER) y le damos acceso al schema
-- public. El detalle fino de RLS (ENABLE/FORCE ROW LEVEL SECURITY + policies)
-- y las extensiones (pgcrypto, btree_gist) los crea la migracion inicial de
-- Alembic, que corre con ADMIN_DATABASE_URL (superusuario).
--
-- app_user es NOSUPERUSER a proposito: FORCE ROW LEVEL SECURITY solo afecta a
-- roles no-superusuario, de modo que la barrera real de multi-tenancy aplica
-- al rol de runtime.

DO
$$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
      CREATE ROLE app_user LOGIN PASSWORD 'app_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   END IF;
END
$$;

-- Conexion a la base de datos de la aplicacion.
GRANT CONNECT ON DATABASE shiftplanner TO app_user;

-- Uso del schema public. La creacion de objetos (tablas) la hace Alembic con
-- el superusuario; app_user solo necesita usar el schema y operar DML.
GRANT USAGE ON SCHEMA public TO app_user;

-- Privilegios sobre objetos ya existentes en public (por si acaso).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Default privileges: cualquier tabla/secuencia que cree despues el
-- superusuario 'postgres' en public queda automaticamente accesible para
-- app_user. Asi el runtime puede operar sobre las tablas creadas por Alembic.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
   GRANT USAGE, SELECT ON SEQUENCES TO app_user;
