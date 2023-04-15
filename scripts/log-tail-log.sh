#!/bin/bash

curl --request POST \
  --url "${URL_TAIL}" \
  --header "Authorization: Bearer ${API_KEY_TAIL}" \
  --header 'Content-Type: application/json' \
  --data '{
	"dt": "'"$(date -u +'%Y-%m-%d %T UTC')"'",
	"message": "'"${MESSAGE}"'"
}'
