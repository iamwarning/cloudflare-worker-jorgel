#!/bin/bash
sed -i "s|\(API_KEY_LOG_TAIL *= *\).*|\1\"${API_KEY_TAIL}\"|" wrangler.toml
sed -i "s|\(LOG_TAIL_URL *= *\).*|\1\"${URL_TAIL}\"|" wrangler.toml
