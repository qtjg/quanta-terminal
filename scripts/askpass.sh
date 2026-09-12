#!/bin/sh
# one-shot GIT_ASKPASS helper — reads token from GITMANCER_PUSH_TOKEN env
case "$1" in
  Username*) echo "qtjg" ;;
  Password*) echo "$GITMANCER_PUSH_TOKEN" ;;
  *) echo "y" ;;
esac
