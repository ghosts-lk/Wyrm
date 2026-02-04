# Wyrm Chronicles // DragonScale

> Session history for DragonScale project

---

## Session: 2026-02-04

### Objectives
- Test fraud protection
- Fix admin login issues
- Fix order status updates

### Completed
1. Tested fraud protection (honeypot, min order time)
2. Fixed session cookie secure flag for HTTP dev
3. Fixed order status updates - SQLite datetime issue
4. Added getAllSettings() function
5. Tested all 9 admin settings tabs

### Issues Solved
- **Login not working:** session.cookie_secure=1 blocked HTTP cookies. Fixed with conditional check for HTTPS.
- **Order status update failed:** NOW() doesn't work in SQLite. Changed to datetime('now').
- **CSRF errors on AJAX:** AJAX files were calling session_start() before bootstrap. Fixed include order.

### Commits
- `d3bbb87` - Fix session handling and order status updates

### Files Changed
- config/bootstrap-security.php
- config/database.php
- admin/ajax/update-status.php
- admin/ajax/bulk-update-status.php
- admin/orders.php
- includes/functions.php

---

## Session: 2026-02-03

### Objectives
- Implement fraud protection system

### Completed
1. Added honeypot fields
2. Added reCAPTCHA v3 support
3. Added rate limiting per IP
4. Added phone/email blocklists
5. Added minimum order time check
6. Created Security settings tab in admin

### Commits
- `07603dd` - Add fraud protection features

### Files Changed
- api/orders.php
- admin/settings.php
- checkout.php
- assets/js/checkout.js
