-- Approved public starter data. No existing accounts, credentials, or activity data.
-- Apply after schema.sql to a new installation, not as a production migration.
BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.users)
       OR EXISTS (SELECT 1 FROM public.courses)
       OR EXISTS (SELECT 1 FROM public.useradmin) THEN
        RAISE EXCEPTION 'Starter data is only for a new installation without users, courses, or login accounts';
    END IF;
END $$;

INSERT INTO public.roles (role_id, role_name) VALUES
    (1, 'Student'),
    (2, 'Instructor')
ON CONFLICT (role_id) DO NOTHING;

INSERT INTO public.gamification_levels (level_id, level_name, min_xp, max_xp, color_hex) VALUES
    (1, 'Rookie', 0, 99, '#6B7280'),
    (2, 'Explorer', 100, 249, '#2F7197'),
    (3, 'Achiever', 250, 499, '#2D6A4F'),
    (4, 'Strategist', 500, 899, '#8A4F08'),
    (5, 'Mastermind', 900, 2499, '#A03C53'),
    (6, 'Specialist', 2500, 4999, '#7C3AED'),
    (7, 'Innovator', 5000, 8499, '#0F766E'),
    (8, 'Expert', 8500, 12999, '#C2410C'),
    (9, 'Grandmaster', 13000, 17999, '#B45309'),
    (10, 'Legend', 18000, NULL, '#111827')
ON CONFLICT (level_id) DO NOTHING;

INSERT INTO public.avatars (avatar_id, avatar_name, avatar_public_path)
SELECT n, 'Student ' || n, '/student' || n || '/'
FROM generate_series(1, 50) AS n
ON CONFLICT (avatar_id) DO NOTHING;

INSERT INTO public.settings (setting_id, setting_key, setting_name, setting_description, setting_type, boolean_value, datetime_value) VALUES
    (1, 'allow_url_login_user_creation', 'Allow URL Login User Creation',
        'Allow public student access links to create a new student account when the email is not registered yet.', 'boolean', FALSE, NULL),
    (2, 'maintenance_mode', 'Maintenance Mode',
        'When active, student login is disabled and active student sessions are logged out.', 'boolean', FALSE, NULL),
    (3, 'maintenance_auto_on_at', 'Maintenance Auto-On Datetime',
        'Automatically turn maintenance mode on at this date and time.', 'datetime', NULL, NULL),
    (4, 'maintenance_auto_off_at', 'Maintenance Auto-Off Datetime',
        'Automatically turn maintenance mode off at this date and time.', 'datetime', NULL, NULL)
ON CONFLICT (setting_key) DO NOTHING;

SELECT setval(pg_get_serial_sequence('public.roles', 'role_id'), (SELECT MAX(role_id) FROM public.roles), TRUE);
SELECT setval(pg_get_serial_sequence('public.avatars', 'avatar_id'), (SELECT MAX(avatar_id) FROM public.avatars), TRUE);
SELECT setval(pg_get_serial_sequence('public.settings', 'setting_id'), (SELECT MAX(setting_id) FROM public.settings), TRUE);

COMMIT;
