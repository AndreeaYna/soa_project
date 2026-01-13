# Nginx Configuration

This directory contains the Nginx configuration used in the Subscription Hub project.

## Purpose

Nginx is used as the public entry point of the system and performs the following roles:

- Serves static frontend applications (micro-frontends)
- Acts as a reverse proxy for REST APIs
- Forwards WebSocket connections for real-time notifications
- Separates public access from internal microservices

## Ports

- **8081** – Public entry point (browser access)
- **8080** – Internal Node.js API Gateway (proxied by Nginx)

## Routing Overview

- `/` and `/ui-customer` → Customer frontend
- `/ui-auth` → Authentication frontend
- `/ui-admin` → Admin frontend
- `/auth/*`, `/orders/*`, `/payments/*` → API Gateway
- `/ws` → WebSocket endpoint (Notifications Service)

## Notes

The API Gateway is responsible for JWT validation and request routing to internal microservices.
Nginx does not implement business logic and is used strictly for routing and proxying purposes.
