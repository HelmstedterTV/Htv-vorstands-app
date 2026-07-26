#!/bin/bash
cd "/Users/Peter/Claude/Projects/Vorstands-App"
firebase login
firebase deploy --project htv-vorstands-app
echo "✓ Deployment abgeschlossen!"
