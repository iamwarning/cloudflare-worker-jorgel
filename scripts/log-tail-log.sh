#!/bin/bash

curl -X POST \
-H 'Content-Type: application/json' \
-H "Authorization: Bearer ${API_KEY_TAIL}" \
-d '{"dt":"'"$(date -u +'%Y-%m-%d %T UTC')"'","message":"Hello from "'"${MESSAGE}"'"!"}' \
-k \
"${URL_TAIL}"
