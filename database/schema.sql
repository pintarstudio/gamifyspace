--
-- PostgreSQL database dump
--

\restrict eFL63p3WdatRHPX5h0bcWQqBdkNkbN1YJr7EhyAyns83vzBmTu3BmSOJe32WZbU

-- Dumped from database version 14.23 (Homebrew)
-- Dumped by pg_dump version 14.23 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: avatars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.avatars (
    avatar_id integer NOT NULL,
    avatar_name character varying(100) NOT NULL,
    avatar_public_path text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone
);


--
-- Name: avatars_avatar_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.avatars_avatar_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: avatars_avatar_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.avatars_avatar_id_seq OWNED BY public.avatars.avatar_id;


--
-- Name: chat_message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_message_reactions (
    chat_message_id integer NOT NULL,
    user_id integer NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    chat_message_id integer NOT NULL,
    chat_room_id integer NOT NULL,
    sender_user_id integer NOT NULL,
    message_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chat_messages_message_text_check CHECK ((char_length(message_text) <= 160))
);


--
-- Name: chat_messages_chat_message_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_chat_message_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_chat_message_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_chat_message_id_seq OWNED BY public.chat_messages.chat_message_id;


--
-- Name: chat_room_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_room_invites (
    chat_room_invite_id integer NOT NULL,
    chat_room_id integer NOT NULL,
    invited_user_id integer NOT NULL,
    invited_by_user_id integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    CONSTRAINT chat_room_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])))
);


--
-- Name: chat_room_invites_chat_room_invite_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_room_invites_chat_room_invite_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_room_invites_chat_room_invite_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_room_invites_chat_room_invite_id_seq OWNED BY public.chat_room_invites.chat_room_invite_id;


--
-- Name: chat_room_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_room_members (
    chat_room_id integer NOT NULL,
    user_id integer NOT NULL,
    last_read_at timestamp with time zone DEFAULT '1970-01-01 07:00:00+07'::timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_rooms (
    chat_room_id integer NOT NULL,
    course_id integer NOT NULL,
    course_group_id integer,
    room_type text NOT NULL,
    room_name text NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT chat_rooms_room_type_check CHECK ((room_type = ANY (ARRAY['broadcast'::text, 'group'::text])))
);


--
-- Name: chat_rooms_chat_room_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_rooms_chat_room_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_rooms_chat_room_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_rooms_chat_room_id_seq OWNED BY public.chat_rooms.chat_room_id;


--
-- Name: course_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_groups (
    course_group_id integer NOT NULL,
    course_id integer NOT NULL,
    group_name text NOT NULL,
    gamification_enabled boolean DEFAULT false NOT NULL,
    virtual_space_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: course_groups_course_group_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.course_groups_course_group_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: course_groups_course_group_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.course_groups_course_group_id_seq OWNED BY public.course_groups.course_group_id;


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    course_id integer NOT NULL,
    course_code character varying(50) NOT NULL,
    course_name character varying(150) NOT NULL,
    semester integer,
    location character varying(150),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    instructor_id integer,
    instructor2_id integer,
    individual_mc_question_seconds integer,
    pre_test_question_seconds integer,
    post_test_question_seconds integer,
    individual_case_seconds integer,
    group_activity_seconds integer,
    quiz_question_seconds integer
);


--
-- Name: courses_course_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.courses_course_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: courses_course_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.courses_course_id_seq OWNED BY public.courses.course_id;


--
-- Name: gamification_group_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gamification_group_scores (
    score_id integer NOT NULL,
    activity_type text NOT NULL,
    activity_id integer NOT NULL,
    group_id integer NOT NULL,
    course_id integer NOT NULL,
    xp_total integer DEFAULT 0 NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gamification_group_scores_score_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gamification_group_scores_score_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gamification_group_scores_score_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gamification_group_scores_score_id_seq OWNED BY public.gamification_group_scores.score_id;


--
-- Name: gamification_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gamification_levels (
    level_id integer NOT NULL,
    level_name text NOT NULL,
    min_xp integer NOT NULL,
    max_xp integer,
    color_hex text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gamification_levels_check CHECK (((max_xp IS NULL) OR (max_xp >= min_xp))),
    CONSTRAINT gamification_levels_level_id_check CHECK (((level_id >= 1) AND (level_id <= 10))),
    CONSTRAINT gamification_levels_min_xp_check CHECK ((min_xp >= 0))
);


--
-- Name: gamification_user_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gamification_user_scores (
    score_id integer NOT NULL,
    activity_type text NOT NULL,
    activity_id integer NOT NULL,
    user_id integer NOT NULL,
    group_id integer NOT NULL,
    course_id integer NOT NULL,
    xp_earned integer DEFAULT 0 NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gamification_user_scores_score_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gamification_user_scores_score_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gamification_user_scores_score_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gamification_user_scores_score_id_seq OWNED BY public.gamification_user_scores.score_id;


--
-- Name: individual_activity_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.individual_activity_answers (
    answer_id integer NOT NULL,
    session_id integer NOT NULL,
    question_id integer NOT NULL,
    user_id integer NOT NULL,
    answer_index integer,
    answer_text text,
    is_correct boolean,
    score integer DEFAULT 0 NOT NULL,
    xp_earned integer DEFAULT 0 NOT NULL,
    answered_at timestamp with time zone DEFAULT now() NOT NULL,
    time_spent_seconds integer DEFAULT 0 NOT NULL
);


--
-- Name: individual_activity_answers_answer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.individual_activity_answers_answer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: individual_activity_answers_answer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.individual_activity_answers_answer_id_seq OWNED BY public.individual_activity_answers.answer_id;


--
-- Name: individual_activity_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.individual_activity_sessions (
    session_id integer NOT NULL,
    course_id integer NOT NULL,
    topic_id integer NOT NULL,
    user_id integer NOT NULL,
    object_id text,
    activity_type text NOT NULL,
    question_kind text NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    question_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    current_question_index integer DEFAULT 0 NOT NULL,
    answer_text text DEFAULT ''::text NOT NULL,
    correct_count integer DEFAULT 0 NOT NULL,
    score_total integer DEFAULT 0 NOT NULL,
    xp_total integer DEFAULT 0 NOT NULL,
    result_json jsonb,
    feedback_json jsonb,
    feedback_model text,
    feedback_status text DEFAULT 'idle'::text NOT NULL,
    feedback_error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    duration_seconds integer DEFAULT 0 NOT NULL,
    seconds_spent integer DEFAULT 0 NOT NULL,
    seconds_left integer DEFAULT 0 NOT NULL,
    current_question_started_at timestamp with time zone DEFAULT now() NOT NULL,
    feedback_started_at timestamp with time zone,
    question_duration_seconds integer,
    CONSTRAINT individual_activity_sessions_activity_type_check CHECK ((activity_type = ANY (ARRAY['exercise'::text, 'pre_test'::text, 'post_test'::text]))),
    CONSTRAINT individual_activity_sessions_question_kind_check CHECK ((question_kind = ANY (ARRAY['multiple_choice'::text, 'case_study'::text])))
);


--
-- Name: individual_activity_sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.individual_activity_sessions_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: individual_activity_sessions_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.individual_activity_sessions_session_id_seq OWNED BY public.individual_activity_sessions.session_id;


--
-- Name: individual_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.individual_questions (
    question_id integer NOT NULL,
    topic_id integer NOT NULL,
    activity_type text NOT NULL,
    question_kind text NOT NULL,
    question_number integer NOT NULL,
    question_text text,
    choices jsonb DEFAULT '[]'::jsonb NOT NULL,
    correct_answer_index integer,
    explanation text,
    case_title text,
    case_prompt text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT individual_questions_activity_type_check CHECK ((activity_type = ANY (ARRAY['exercise'::text, 'pre_test'::text, 'post_test'::text]))),
    CONSTRAINT individual_questions_question_kind_check CHECK ((question_kind = ANY (ARRAY['multiple_choice'::text, 'case_study'::text])))
);


--
-- Name: individual_questions_question_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.individual_questions_question_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: individual_questions_question_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.individual_questions_question_id_seq OWNED BY public.individual_questions.question_id;


--
-- Name: question_instruction_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_instruction_presets (
    preset_id integer NOT NULL,
    preset_name text NOT NULL,
    instruction_text text NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: question_instruction_presets_preset_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.question_instruction_presets_preset_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: question_instruction_presets_preset_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.question_instruction_presets_preset_id_seq OWNED BY public.question_instruction_presets.preset_id;


--
-- Name: quiz_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_answers (
    answer_id integer NOT NULL,
    quiz_session_id integer NOT NULL,
    user_id integer NOT NULL,
    question_id integer NOT NULL,
    answer_index integer,
    is_correct boolean DEFAULT false NOT NULL,
    time_taken_seconds integer DEFAULT 15 NOT NULL,
    time_left_seconds integer DEFAULT 0 NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    bonus_score integer DEFAULT 0 NOT NULL,
    answered_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quiz_answers_answer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quiz_answers_answer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quiz_answers_answer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quiz_answers_answer_id_seq OWNED BY public.quiz_answers.answer_id;


--
-- Name: quiz_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_members (
    member_id integer NOT NULL,
    quiz_session_id integer NOT NULL,
    user_id integer NOT NULL,
    avatar_public_path text,
    is_active boolean DEFAULT true NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quiz_members_member_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quiz_members_member_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quiz_members_member_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quiz_members_member_id_seq OWNED BY public.quiz_members.member_id;


--
-- Name: quiz_question_bank; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_question_bank (
    question_id integer NOT NULL,
    topic_id integer NOT NULL,
    question_number integer NOT NULL,
    question_text text NOT NULL,
    choices jsonb NOT NULL,
    correct_answer_index integer NOT NULL,
    explanation text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quiz_question_bank_correct_answer_index_check CHECK (((correct_answer_index >= 0) AND (correct_answer_index <= 3)))
);


--
-- Name: quiz_question_bank_question_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quiz_question_bank_question_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quiz_question_bank_question_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quiz_question_bank_question_id_seq OWNED BY public.quiz_question_bank.question_id;


--
-- Name: quiz_session_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_session_results (
    result_id integer NOT NULL,
    quiz_session_id integer NOT NULL,
    saved_by integer NOT NULL,
    questions_json jsonb NOT NULL,
    answers_json jsonb NOT NULL,
    results_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quiz_session_results_result_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quiz_session_results_result_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quiz_session_results_result_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quiz_session_results_result_id_seq OWNED BY public.quiz_session_results.result_id;


--
-- Name: quiz_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_sessions (
    quiz_session_id integer NOT NULL,
    course_id integer NOT NULL,
    topic_id integer NOT NULL,
    table_id text NOT NULL,
    object_id text,
    status text DEFAULT 'lobby'::text NOT NULL,
    question_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    current_question_index integer DEFAULT 0 NOT NULL,
    question_started_at timestamp with time zone,
    hosted_by integer NOT NULL,
    saved_by integer,
    saved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    group_id integer,
    question_completed_at timestamp with time zone,
    course_group_id integer,
    save_status text DEFAULT 'idle'::text NOT NULL,
    save_started_at timestamp with time zone,
    save_error text,
    question_time_seconds integer
);


--
-- Name: quiz_sessions_quiz_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quiz_sessions_quiz_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quiz_sessions_quiz_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quiz_sessions_quiz_session_id_seq OWNED BY public.quiz_sessions.quiz_session_id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    role_id integer NOT NULL,
    role_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles_role_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_role_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_role_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_role_id_seq OWNED BY public.roles.role_id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id integer NOT NULL,
    session_id character varying(128) NOT NULL,
    user_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    expired_at timestamp without time zone DEFAULT (CURRENT_TIMESTAMP + '02:00:00'::interval),
    is_active boolean DEFAULT true,
    course_id integer,
    avatar_id integer,
    maintenance_demo_access boolean DEFAULT false NOT NULL
);


--
-- Name: sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sessions_id_seq OWNED BY public.sessions.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    setting_id integer NOT NULL,
    setting_key text NOT NULL,
    setting_name text NOT NULL,
    setting_description text,
    setting_type text NOT NULL,
    boolean_value boolean,
    text_value text,
    number_value numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    datetime_value timestamp with time zone,
    CONSTRAINT settings_setting_type_check CHECK ((setting_type = ANY (ARRAY['boolean'::text, 'text'::text, 'number'::text, 'datetime'::text])))
);


--
-- Name: settings_setting_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_setting_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_setting_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_setting_id_seq OWNED BY public.settings.setting_id;


--
-- Name: table_group_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_group_answers (
    answer_id integer NOT NULL,
    session_id integer NOT NULL,
    user_id integer NOT NULL,
    answer_text text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: table_group_answers_answer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_group_answers_answer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_group_answers_answer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_group_answers_answer_id_seq OWNED BY public.table_group_answers.answer_id;


--
-- Name: table_group_feedback_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_group_feedback_groups (
    feedback_group_id integer NOT NULL,
    session_id integer NOT NULL,
    student_ids integer[] NOT NULL,
    student_names text[] NOT NULL,
    www text NOT NULL,
    ebi text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: table_group_feedback_groups_feedback_group_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_group_feedback_groups_feedback_group_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_group_feedback_groups_feedback_group_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_group_feedback_groups_feedback_group_id_seq OWNED BY public.table_group_feedback_groups.feedback_group_id;


--
-- Name: table_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_group_members (
    member_id integer NOT NULL,
    session_id integer NOT NULL,
    user_id integer NOT NULL,
    avatar_public_path text,
    is_active boolean DEFAULT true NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    object_id text
);


--
-- Name: table_group_members_member_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_group_members_member_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_group_members_member_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_group_members_member_id_seq OWNED BY public.table_group_members.member_id;


--
-- Name: table_group_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_group_sessions (
    session_id integer NOT NULL,
    course_id integer NOT NULL,
    topic_id integer,
    group_id integer NOT NULL,
    object_id text,
    case_title text,
    case_prompt text,
    answer_text text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    submitted_by integer,
    submitted_at timestamp with time zone,
    feedback_text text,
    case_id integer,
    combined_feedback jsonb,
    feedback_model text,
    feedback_generated_at timestamp with time zone,
    feedback_status text DEFAULT 'idle'::text NOT NULL,
    feedback_started_at timestamp with time zone,
    feedback_error text,
    duration_seconds integer DEFAULT 600 NOT NULL,
    seconds_spent integer DEFAULT 0 NOT NULL,
    seconds_left integer DEFAULT 600 NOT NULL,
    work_started_at timestamp with time zone,
    course_group_id integer
);


--
-- Name: table_group_sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_group_sessions_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_group_sessions_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_group_sessions_session_id_seq OWNED BY public.table_group_sessions.session_id;


--
-- Name: topic_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topic_cases (
    case_id integer NOT NULL,
    topic_id integer NOT NULL,
    case_number integer NOT NULL,
    case_title text NOT NULL,
    case_prompt text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: topic_cases_case_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.topic_cases_case_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: topic_cases_case_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.topic_cases_case_id_seq OWNED BY public.topic_cases.case_id;


--
-- Name: topic_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topic_materials (
    material_id integer NOT NULL,
    topic_id integer NOT NULL,
    title text NOT NULL,
    content_text text NOT NULL,
    content_token_estimate integer DEFAULT 0 NOT NULL,
    digest_json jsonb,
    digest_model text,
    digest_status text DEFAULT 'idle'::text NOT NULL,
    digest_error text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: topic_materials_material_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.topic_materials_material_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: topic_materials_material_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.topic_materials_material_id_seq OWNED BY public.topic_materials.material_id;


--
-- Name: topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topics (
    topic_id integer NOT NULL,
    course_id integer NOT NULL,
    topic_name character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    deleted_at timestamp without time zone,
    show_topic boolean DEFAULT true NOT NULL,
    week integer,
    show_pre_test boolean DEFAULT true NOT NULL,
    show_post_test boolean DEFAULT true NOT NULL,
    pre_test_start_at timestamp with time zone,
    pre_test_end_at timestamp with time zone,
    post_test_start_at timestamp with time zone,
    post_test_end_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: topics_topic_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.topics_topic_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: topics_topic_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.topics_topic_id_seq OWNED BY public.topics.topic_id;


--
-- Name: user_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_logs (
    log_id integer NOT NULL,
    user_id integer,
    action_type character varying(50),
    details jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_logs_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_logs_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_logs_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_logs_log_id_seq OWNED BY public.user_logs.log_id;


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL,
    current_room character varying(100)
);


--
-- Name: useradmin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.useradmin (
    useradmin_id integer NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    last_login timestamp with time zone,
    role text NOT NULL,
    is_disabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id integer,
    CONSTRAINT useradmin_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'instructor'::text])))
);


--
-- Name: useradmin_useradmin_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.useradmin_useradmin_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: useradmin_useradmin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.useradmin_useradmin_id_seq OWNED BY public.useradmin.useradmin_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    name character varying(100) NOT NULL,
    email character varying(100) NOT NULL,
    course_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    course_group_id integer,
    role_id integer DEFAULT 1 NOT NULL
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: avatars avatar_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.avatars ALTER COLUMN avatar_id SET DEFAULT nextval('public.avatars_avatar_id_seq'::regclass);


--
-- Name: chat_messages chat_message_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN chat_message_id SET DEFAULT nextval('public.chat_messages_chat_message_id_seq'::regclass);


--
-- Name: chat_room_invites chat_room_invite_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_invites ALTER COLUMN chat_room_invite_id SET DEFAULT nextval('public.chat_room_invites_chat_room_invite_id_seq'::regclass);


--
-- Name: chat_rooms chat_room_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms ALTER COLUMN chat_room_id SET DEFAULT nextval('public.chat_rooms_chat_room_id_seq'::regclass);


--
-- Name: course_groups course_group_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_groups ALTER COLUMN course_group_id SET DEFAULT nextval('public.course_groups_course_group_id_seq'::regclass);


--
-- Name: courses course_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses ALTER COLUMN course_id SET DEFAULT nextval('public.courses_course_id_seq'::regclass);


--
-- Name: gamification_group_scores score_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_group_scores ALTER COLUMN score_id SET DEFAULT nextval('public.gamification_group_scores_score_id_seq'::regclass);


--
-- Name: gamification_user_scores score_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_user_scores ALTER COLUMN score_id SET DEFAULT nextval('public.gamification_user_scores_score_id_seq'::regclass);


--
-- Name: individual_activity_answers answer_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_activity_answers ALTER COLUMN answer_id SET DEFAULT nextval('public.individual_activity_answers_answer_id_seq'::regclass);


--
-- Name: individual_activity_sessions session_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_activity_sessions ALTER COLUMN session_id SET DEFAULT nextval('public.individual_activity_sessions_session_id_seq'::regclass);


--
-- Name: individual_questions question_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_questions ALTER COLUMN question_id SET DEFAULT nextval('public.individual_questions_question_id_seq'::regclass);


--
-- Name: question_instruction_presets preset_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_instruction_presets ALTER COLUMN preset_id SET DEFAULT nextval('public.question_instruction_presets_preset_id_seq'::regclass);


--
-- Name: quiz_answers answer_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers ALTER COLUMN answer_id SET DEFAULT nextval('public.quiz_answers_answer_id_seq'::regclass);


--
-- Name: quiz_members member_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_members ALTER COLUMN member_id SET DEFAULT nextval('public.quiz_members_member_id_seq'::regclass);


--
-- Name: quiz_question_bank question_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_question_bank ALTER COLUMN question_id SET DEFAULT nextval('public.quiz_question_bank_question_id_seq'::regclass);


--
-- Name: quiz_session_results result_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_session_results ALTER COLUMN result_id SET DEFAULT nextval('public.quiz_session_results_result_id_seq'::regclass);


--
-- Name: quiz_sessions quiz_session_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions ALTER COLUMN quiz_session_id SET DEFAULT nextval('public.quiz_sessions_quiz_session_id_seq'::regclass);


--
-- Name: roles role_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN role_id SET DEFAULT nextval('public.roles_role_id_seq'::regclass);


--
-- Name: sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions ALTER COLUMN id SET DEFAULT nextval('public.sessions_id_seq'::regclass);


--
-- Name: settings setting_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN setting_id SET DEFAULT nextval('public.settings_setting_id_seq'::regclass);


--
-- Name: table_group_answers answer_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_answers ALTER COLUMN answer_id SET DEFAULT nextval('public.table_group_answers_answer_id_seq'::regclass);


--
-- Name: table_group_feedback_groups feedback_group_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_feedback_groups ALTER COLUMN feedback_group_id SET DEFAULT nextval('public.table_group_feedback_groups_feedback_group_id_seq'::regclass);


--
-- Name: table_group_members member_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_members ALTER COLUMN member_id SET DEFAULT nextval('public.table_group_members_member_id_seq'::regclass);


--
-- Name: table_group_sessions session_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_sessions ALTER COLUMN session_id SET DEFAULT nextval('public.table_group_sessions_session_id_seq'::regclass);


--
-- Name: topic_cases case_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_cases ALTER COLUMN case_id SET DEFAULT nextval('public.topic_cases_case_id_seq'::regclass);


--
-- Name: topic_materials material_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_materials ALTER COLUMN material_id SET DEFAULT nextval('public.topic_materials_material_id_seq'::regclass);


--
-- Name: topics topic_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics ALTER COLUMN topic_id SET DEFAULT nextval('public.topics_topic_id_seq'::regclass);


--
-- Name: user_logs log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logs ALTER COLUMN log_id SET DEFAULT nextval('public.user_logs_log_id_seq'::regclass);


--
-- Name: useradmin useradmin_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.useradmin ALTER COLUMN useradmin_id SET DEFAULT nextval('public.useradmin_useradmin_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: avatars avatars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.avatars
    ADD CONSTRAINT avatars_pkey PRIMARY KEY (avatar_id);


--
-- Name: chat_message_reactions chat_message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_pkey PRIMARY KEY (chat_message_id, user_id, emoji);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (chat_message_id);


--
-- Name: chat_room_invites chat_room_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_invites
    ADD CONSTRAINT chat_room_invites_pkey PRIMARY KEY (chat_room_invite_id);


--
-- Name: chat_room_members chat_room_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_pkey PRIMARY KEY (chat_room_id, user_id);


--
-- Name: chat_rooms chat_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_pkey PRIMARY KEY (chat_room_id);


--
-- Name: course_groups course_groups_course_id_group_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_groups
    ADD CONSTRAINT course_groups_course_id_group_name_key UNIQUE (course_id, group_name);


--
-- Name: course_groups course_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_groups
    ADD CONSTRAINT course_groups_pkey PRIMARY KEY (course_group_id);


--
-- Name: courses courses_course_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_course_code_key UNIQUE (course_code);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (course_id);


--
-- Name: gamification_group_scores gamification_group_scores_activity_type_activity_id_group_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_group_scores
    ADD CONSTRAINT gamification_group_scores_activity_type_activity_id_group_i_key UNIQUE (activity_type, activity_id, group_id);


--
-- Name: gamification_group_scores gamification_group_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_group_scores
    ADD CONSTRAINT gamification_group_scores_pkey PRIMARY KEY (score_id);


--
-- Name: gamification_levels gamification_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_levels
    ADD CONSTRAINT gamification_levels_pkey PRIMARY KEY (level_id);


--
-- Name: gamification_user_scores gamification_user_scores_activity_type_activity_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_user_scores
    ADD CONSTRAINT gamification_user_scores_activity_type_activity_id_user_id_key UNIQUE (activity_type, activity_id, user_id);


--
-- Name: gamification_user_scores gamification_user_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_user_scores
    ADD CONSTRAINT gamification_user_scores_pkey PRIMARY KEY (score_id);


--
-- Name: individual_activity_answers individual_activity_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_activity_answers
    ADD CONSTRAINT individual_activity_answers_pkey PRIMARY KEY (answer_id);


--
-- Name: individual_activity_answers individual_activity_answers_session_id_question_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_activity_answers
    ADD CONSTRAINT individual_activity_answers_session_id_question_id_user_id_key UNIQUE (session_id, question_id, user_id);


--
-- Name: individual_activity_sessions individual_activity_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_activity_sessions
    ADD CONSTRAINT individual_activity_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: individual_questions individual_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_questions
    ADD CONSTRAINT individual_questions_pkey PRIMARY KEY (question_id);


--
-- Name: individual_questions individual_questions_topic_id_activity_type_question_kind_q_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_questions
    ADD CONSTRAINT individual_questions_topic_id_activity_type_question_kind_q_key UNIQUE (topic_id, activity_type, question_kind, question_number);


--
-- Name: question_instruction_presets question_instruction_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_instruction_presets
    ADD CONSTRAINT question_instruction_presets_pkey PRIMARY KEY (preset_id);


--
-- Name: quiz_answers quiz_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers
    ADD CONSTRAINT quiz_answers_pkey PRIMARY KEY (answer_id);


--
-- Name: quiz_answers quiz_answers_quiz_session_id_user_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers
    ADD CONSTRAINT quiz_answers_quiz_session_id_user_id_question_id_key UNIQUE (quiz_session_id, user_id, question_id);


--
-- Name: quiz_members quiz_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_members
    ADD CONSTRAINT quiz_members_pkey PRIMARY KEY (member_id);


--
-- Name: quiz_members quiz_members_quiz_session_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_members
    ADD CONSTRAINT quiz_members_quiz_session_id_user_id_key UNIQUE (quiz_session_id, user_id);


--
-- Name: quiz_question_bank quiz_question_bank_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_question_bank
    ADD CONSTRAINT quiz_question_bank_pkey PRIMARY KEY (question_id);


--
-- Name: quiz_question_bank quiz_question_bank_topic_id_question_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_question_bank
    ADD CONSTRAINT quiz_question_bank_topic_id_question_number_key UNIQUE (topic_id, question_number);


--
-- Name: quiz_session_results quiz_session_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_session_results
    ADD CONSTRAINT quiz_session_results_pkey PRIMARY KEY (result_id);


--
-- Name: quiz_session_results quiz_session_results_quiz_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_session_results
    ADD CONSTRAINT quiz_session_results_quiz_session_id_key UNIQUE (quiz_session_id);


--
-- Name: quiz_sessions quiz_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_pkey PRIMARY KEY (quiz_session_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (role_id);


--
-- Name: roles roles_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_role_name_key UNIQUE (role_name);


--
-- Name: user_sessions session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_session_id_key UNIQUE (session_id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (setting_id);


--
-- Name: settings settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_setting_key_key UNIQUE (setting_key);


--
-- Name: table_group_answers table_group_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_answers
    ADD CONSTRAINT table_group_answers_pkey PRIMARY KEY (answer_id);


--
-- Name: table_group_answers table_group_answers_session_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_answers
    ADD CONSTRAINT table_group_answers_session_id_user_id_key UNIQUE (session_id, user_id);


--
-- Name: table_group_feedback_groups table_group_feedback_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_feedback_groups
    ADD CONSTRAINT table_group_feedback_groups_pkey PRIMARY KEY (feedback_group_id);


--
-- Name: table_group_members table_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_members
    ADD CONSTRAINT table_group_members_pkey PRIMARY KEY (member_id);


--
-- Name: table_group_members table_group_members_session_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_members
    ADD CONSTRAINT table_group_members_session_id_user_id_key UNIQUE (session_id, user_id);


--
-- Name: table_group_sessions table_group_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_sessions
    ADD CONSTRAINT table_group_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: topic_cases topic_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_cases
    ADD CONSTRAINT topic_cases_pkey PRIMARY KEY (case_id);


--
-- Name: topic_cases topic_cases_topic_id_case_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_cases
    ADD CONSTRAINT topic_cases_topic_id_case_number_key UNIQUE (topic_id, case_number);


--
-- Name: topic_materials topic_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_materials
    ADD CONSTRAINT topic_materials_pkey PRIMARY KEY (material_id);


--
-- Name: topics topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (topic_id);


--
-- Name: user_logs user_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logs
    ADD CONSTRAINT user_logs_pkey PRIMARY KEY (log_id);


--
-- Name: useradmin useradmin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.useradmin
    ADD CONSTRAINT useradmin_pkey PRIMARY KEY (useradmin_id);


--
-- Name: useradmin useradmin_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.useradmin
    ADD CONSTRAINT useradmin_username_key UNIQUE (username);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: chat_message_reactions_one_per_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chat_message_reactions_one_per_user_idx ON public.chat_message_reactions USING btree (chat_message_id, user_id);


--
-- Name: chat_messages_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_room_idx ON public.chat_messages USING btree (chat_room_id, created_at DESC);


--
-- Name: chat_room_invites_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chat_room_invites_pending_idx ON public.chat_room_invites USING btree (chat_room_id, invited_user_id) WHERE (status = 'pending'::text);


--
-- Name: chat_room_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_room_members_user_idx ON public.chat_room_members USING btree (user_id);


--
-- Name: chat_rooms_course_broadcast_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chat_rooms_course_broadcast_idx ON public.chat_rooms USING btree (course_id) WHERE ((room_type = 'broadcast'::text) AND (deleted_at IS NULL));


--
-- Name: chat_rooms_course_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_rooms_course_group_idx ON public.chat_rooms USING btree (course_id, course_group_id, room_type);


--
-- Name: individual_activity_one_active_computer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX individual_activity_one_active_computer_idx ON public.individual_activity_sessions USING btree (course_id, object_id) WHERE ((status = 'in_progress'::text) AND (COALESCE(object_id, ''::text) <> ''::text));


--
-- Name: individual_activity_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX individual_activity_one_active_idx ON public.individual_activity_sessions USING btree (course_id, user_id, object_id) WHERE (status = 'in_progress'::text);


--
-- Name: question_instruction_presets_name_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX question_instruction_presets_name_unique_idx ON public.question_instruction_presets USING btree (lower(preset_name));


--
-- Name: quiz_sessions_one_open_table_course_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quiz_sessions_one_open_table_course_group_idx ON public.quiz_sessions USING btree (course_id, COALESCE(course_group_id, 0), table_id) WHERE (status = ANY (ARRAY['lobby'::text, 'in_progress'::text, 'completed'::text]));


--
-- Name: table_group_sessions_one_active_course_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX table_group_sessions_one_active_course_group_idx ON public.table_group_sessions USING btree (course_id, COALESCE(course_group_id, 0), group_id) WHERE (is_active = true);


--
-- Name: useradmin_user_id_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX useradmin_user_id_unique_idx ON public.useradmin USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: users_course_email_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_course_email_unique_idx ON public.users USING btree (course_id, lower(TRIM(BOTH FROM email))) WHERE (deleted_at IS NULL);


--
-- Name: users_course_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_course_group_id_idx ON public.users USING btree (course_group_id);


--
-- Name: users_role_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_role_id_idx ON public.users USING btree (role_id);


--
-- Name: chat_message_reactions chat_message_reactions_chat_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_chat_message_id_fkey FOREIGN KEY (chat_message_id) REFERENCES public.chat_messages(chat_message_id) ON DELETE CASCADE;


--
-- Name: chat_message_reactions chat_message_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_chat_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_chat_room_id_fkey FOREIGN KEY (chat_room_id) REFERENCES public.chat_rooms(chat_room_id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_sender_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES public.users(user_id);


--
-- Name: chat_room_invites chat_room_invites_chat_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_invites
    ADD CONSTRAINT chat_room_invites_chat_room_id_fkey FOREIGN KEY (chat_room_id) REFERENCES public.chat_rooms(chat_room_id) ON DELETE CASCADE;


--
-- Name: chat_room_invites chat_room_invites_invited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_invites
    ADD CONSTRAINT chat_room_invites_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: chat_room_invites chat_room_invites_invited_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_invites
    ADD CONSTRAINT chat_room_invites_invited_user_id_fkey FOREIGN KEY (invited_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: chat_room_members chat_room_members_chat_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_chat_room_id_fkey FOREIGN KEY (chat_room_id) REFERENCES public.chat_rooms(chat_room_id) ON DELETE CASCADE;


--
-- Name: chat_room_members chat_room_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_room_members
    ADD CONSTRAINT chat_room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: chat_rooms chat_rooms_course_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_course_group_id_fkey FOREIGN KEY (course_group_id) REFERENCES public.course_groups(course_group_id);


--
-- Name: chat_rooms chat_rooms_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(course_id);


--
-- Name: chat_rooms chat_rooms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_rooms
    ADD CONSTRAINT chat_rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: course_groups course_groups_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_groups
    ADD CONSTRAINT course_groups_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(course_id);


--
-- Name: courses courses_instructor2_id_users_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_instructor2_id_users_fkey FOREIGN KEY (instructor2_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: courses courses_instructor_id_users_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_instructor_id_users_fkey FOREIGN KEY (instructor_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: sessions fk_sessions_avatar; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT fk_sessions_avatar FOREIGN KEY (avatar_id) REFERENCES public.avatars(avatar_id) ON DELETE SET NULL;


--
-- Name: sessions fk_sessions_course; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT fk_sessions_course FOREIGN KEY (course_id) REFERENCES public.courses(course_id) ON DELETE SET NULL;


--
-- Name: topics fk_topics_courses; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT fk_topics_courses FOREIGN KEY (course_id) REFERENCES public.courses(course_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: individual_activity_answers individual_activity_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_activity_answers
    ADD CONSTRAINT individual_activity_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.individual_questions(question_id);


--
-- Name: individual_activity_answers individual_activity_answers_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_activity_answers
    ADD CONSTRAINT individual_activity_answers_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.individual_activity_sessions(session_id) ON DELETE CASCADE;


--
-- Name: question_instruction_presets question_instruction_presets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_instruction_presets
    ADD CONSTRAINT question_instruction_presets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.useradmin(useradmin_id) ON DELETE SET NULL;


--
-- Name: quiz_answers quiz_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers
    ADD CONSTRAINT quiz_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.quiz_question_bank(question_id);


--
-- Name: quiz_answers quiz_answers_quiz_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers
    ADD CONSTRAINT quiz_answers_quiz_session_id_fkey FOREIGN KEY (quiz_session_id) REFERENCES public.quiz_sessions(quiz_session_id) ON DELETE CASCADE;


--
-- Name: quiz_members quiz_members_quiz_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_members
    ADD CONSTRAINT quiz_members_quiz_session_id_fkey FOREIGN KEY (quiz_session_id) REFERENCES public.quiz_sessions(quiz_session_id) ON DELETE CASCADE;


--
-- Name: quiz_session_results quiz_session_results_quiz_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_session_results
    ADD CONSTRAINT quiz_session_results_quiz_session_id_fkey FOREIGN KEY (quiz_session_id) REFERENCES public.quiz_sessions(quiz_session_id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: table_group_answers table_group_answers_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_answers
    ADD CONSTRAINT table_group_answers_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.table_group_sessions(session_id) ON DELETE CASCADE;


--
-- Name: table_group_feedback_groups table_group_feedback_groups_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_feedback_groups
    ADD CONSTRAINT table_group_feedback_groups_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.table_group_sessions(session_id) ON DELETE CASCADE;


--
-- Name: table_group_members table_group_members_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_members
    ADD CONSTRAINT table_group_members_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.table_group_sessions(session_id) ON DELETE CASCADE;


--
-- Name: table_group_sessions table_group_sessions_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_group_sessions
    ADD CONSTRAINT table_group_sessions_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.topic_cases(case_id);


--
-- Name: topic_materials topic_materials_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_materials
    ADD CONSTRAINT topic_materials_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.useradmin(useradmin_id);


--
-- Name: topic_materials topic_materials_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_materials
    ADD CONSTRAINT topic_materials_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(topic_id);


--
-- Name: user_logs user_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logs
    ADD CONSTRAINT user_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: useradmin useradmin_user_id_users_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.useradmin
    ADD CONSTRAINT useradmin_user_id_users_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: users users_course_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_course_group_id_fkey FOREIGN KEY (course_group_id) REFERENCES public.course_groups(course_group_id);


--
-- Name: users users_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(course_id) ON DELETE SET NULL;


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(role_id);


--
-- PostgreSQL database dump complete
--

\unrestrict eFL63p3WdatRHPX5h0bcWQqBdkNkbN1YJr7EhyAyns83vzBmTu3BmSOJe32WZbU

