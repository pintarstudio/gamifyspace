#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/logs"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_PID="$LOG_DIR/backend.pid"
FRONTEND_PID="$LOG_DIR/frontend.pid"
BACKEND_PORT="${BACKEND_PORT:-4000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

mkdir -p "$LOG_DIR"

port_pids() {
  local port="$1"
  lsof -ti "tcp:$port" 2>/dev/null || true
}

format_pids() {
  tr '\n' ' ' | sed 's/[[:space:]]*$//'
}

stop_pid_file() {
  local pid_file="$1"
  local name="$2"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $name pid $pid..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$pid_file"
  fi
}

stop_port() {
  local port="$1"
  local pids
  pids="$(port_pids "$port" | format_pids)"
  if [[ -n "$pids" ]]; then
    echo "Stopping processes on port $port: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(port_pids "$port" | format_pids)"
    if [[ -n "$pids" ]]; then
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

start_backend() {
  stop_port "$BACKEND_PORT"
  echo "Starting backend on port $BACKEND_PORT..."
  nohup bash -c "cd '$BACKEND_DIR' && exec env PORT='$BACKEND_PORT' node server.js" > "$BACKEND_LOG" 2>&1 < /dev/null &
  echo $! > "$BACKEND_PID"
}

start_frontend() {
  stop_port "$FRONTEND_PORT"
  echo "Starting frontend on port $FRONTEND_PORT..."
  nohup bash -c "cd '$FRONTEND_DIR' && tail -f /dev/null | env PORT='$FRONTEND_PORT' BROWSER=none npm start" > "$FRONTEND_LOG" 2>&1 &
  echo $! > "$FRONTEND_PID"
}

start_all() {
  start_backend
  start_frontend
  echo "Backend log:  $BACKEND_LOG"
  echo "Frontend log: $FRONTEND_LOG"
  echo "Frontend URL: http://localhost:$FRONTEND_PORT"
  echo "Backend URL:  http://localhost:$BACKEND_PORT"
}

stop_all() {
  stop_pid_file "$FRONTEND_PID" "frontend"
  stop_pid_file "$BACKEND_PID" "backend"
  stop_port "$FRONTEND_PORT"
  stop_port "$BACKEND_PORT"
}

status_one() {
  local name="$1"
  local port="$2"
  local pids
  pids="$(port_pids "$port" | format_pids)"
  if [[ -n "$pids" ]]; then
    echo "$name: running on port $port ($pids)"
  else
    echo "$name: stopped on port $port"
  fi
}

show_status() {
  status_one "Backend" "$BACKEND_PORT"
  status_one "Frontend" "$FRONTEND_PORT"
}

show_logs() {
  echo "==> Backend log: $BACKEND_LOG"
  tail -n 60 "$BACKEND_LOG" 2>/dev/null || true
  echo
  echo "==> Frontend log: $FRONTEND_LOG"
  tail -n 60 "$FRONTEND_LOG" 2>/dev/null || true
}

case "${1:-restart}" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_all
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
