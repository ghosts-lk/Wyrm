# Wyrm Hoard // DragonScale

> **Last Updated:** 2026-02-04
> **Project:** DragonScale
> **Repo:** ghosts-lk/DragonScale

## Project Overview

**Name:** DragonScale  
**Type:** Restaurant ordering system with admin panel  
**Stack:** PHP 8.4, SQLite, Vanilla JS, CSS  

## Current Status

### Completed
- [x] Menu display and cart system
- [x] Checkout with delivery zones (A/B/C routes)
- [x] Admin authentication with Argon2ID
- [x] Order management and status updates
- [x] Discount/coupon system
- [x] Fraud protection (honeypot, rate limiting, blocklists)
- [x] CSRF on all forms
- [x] Settings panel (9 tabs)
- [x] Audit logging

### In Progress
- [ ] PayHere production integration
- [ ] SMTP email sending

## Architecture

### Key Files
| File | Purpose |
|------|---------|
| config/bootstrap-security.php | Session init, security headers |
| config/database.php | DB connection (SQLite/MySQL) |
| includes/functions.php | Core helpers, order functions |
| includes/security.php | CSRF, rate limiting, validation |
| api/orders.php | Order API with fraud protection |
| admin/settings.php | All settings (9 tabs) |

### Database
- **Driver:** SQLite (MySQL supported)
- **File:** config/upalis.db
- **Prefix:** upalis_

### API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/menu.php | GET | Menu items and categories |
| /api/orders.php | POST | Create order |
| /api/orders.php?action=track | GET | Track order status |
| /api/health.php | GET | System health check |

## Credentials (Dev Only)

- **Admin:** /admin/
- **User:** admin
- **Pass:** Admin@12345

## Decisions

### ADR-001: SQLite Default
Using SQLite for easy local dev. MySQL switch via DB_DRIVER constant.

### ADR-002: Session Name
Custom session name (UPALIS_SESSION) to avoid conflicts and enable secure settings.

### ADR-003: No Framework
Vanilla PHP for simplicity, performance, and easy deployment on any hosting.

## Notes

- Use datetime('now') not NOW() for SQLite
- Include bootstrap-security.php before any session operations
- CSRF tokens required on all POST requests
