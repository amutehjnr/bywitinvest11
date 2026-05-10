# LucrativeETF – Production-Ready Investment Platform

A full-stack investment platform built with **Node.js, Express, EJS, and MongoDB**, hardened for production deployment.

---

## 🔐 Security Architecture

| Layer | Measures |
|---|---|
| **HTTP Headers** | Helmet.js — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| **CSRF** | `csurf` token on every state-changing form (POST/PUT/DELETE) |
| **Rate Limiting** | Auth routes: 10 req/15 min · Financial ops: 20 req/hr · Contact: 5 req/hr · General: 200 req/15 min |
| **NoSQL Injection** | `express-mongo-sanitize` sanitises all request bodies/params |
| **HTTP Param Pollution** | `hpp` middleware strips duplicate query params |
| **Password Hashing** | bcrypt with cost factor 12 |
| **Brute-Force Protection** | Account locks after 5 failed login attempts (2-hour lock) |
| **Session Fixation** | Session regenerated on login and registration |
| **Session Storage** | MongoDB-backed + encrypted cookie (`connect-mongo`) |
| **Cookie Security** | `httpOnly`, `secure` (prod), `sameSite: lax`, `__Host-` prefix |
| **Input Validation** | `express-validator` on all routes with strict field rules |
| **Upload Security** | Multer — MIME type allowlist (images only), 5 MB cap, random filenames |
| **Body Size Limit** | JSON/URL-encoded bodies capped at 10 KB |
| **ObjectId Validation** | Regex validation before any `findById` to prevent CastError crashes |
| **Admin Protection** | Cannot delete or deactivate admin accounts via UI |
| **Atomic Financials** | Balance deductions use `findOneAndUpdate` with `$gte` guard to prevent race conditions |
| **Error Handling** | Structured Winston logging; generic messages in production (no stack leaks) |
| **Password Tokens** | Cryptographically random 32-byte hex tokens with 1-hour expiry |
| **Compression** | Gzip via `compression` middleware |
| **Cache Headers** | Static assets cached 7 days in production |

---

## 🚀 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 18+ · Express 4 |
| Templating | EJS |
| Database | MongoDB + Mongoose 8 |
| Auth | express-session · bcryptjs |
| Security | helmet · csurf · express-mongo-sanitize · hpp · express-rate-limit |
| File Upload | Multer |
| Email | Nodemailer |
| Logging | Winston |
| Frontend | Bootstrap 5 · Font Awesome 6 |

---

## 📁 Project Structure

```
bywitinvest/
├── app.js                        # Main Express application
├── seed.js                       # One-time database seeder
├── .env.example                  # Environment variable template
├── config/
│   ├── db.js                     # MongoDB connection (with retry)
│   ├── logger.js                 # Winston logger
│   ├── mailer.js                 # Nodemailer transporter
│   ├── rateLimit.js              # Rate limiter presets
│   └── upload.js                 # Multer config (MIME validation)
├── middleware/
│   ├── auth.js                   # ensureAuth · ensureAdmin · ensureGuest · attachCsrf
│   ├── security.js               # Helmet · mongoSanitize · hpp
│   └── uploadError.js            # Multer error handler
├── models/
│   ├── User.js                   # User schema (brute-force, bcrypt cost 12)
│   └── index.js                  # All other schemas
├── routes/
│   ├── public.js                 # Public pages + contact form
│   ├── auth.js                   # Login/Register/Logout/Password reset
│   ├── dashboard.js              # Authenticated user dashboard
│   └── admin.js                  # Admin panel
├── views/
│   ├── partials/                 # head, navbar, footer, flash, sidebar, admin-sidebar
│   ├── auth/                     # login, register, forgot-password, reset-password
│   ├── dashboard/                # index, invest, deposit, withdraw, transactions, profile
│   ├── admin/                    # index, users, deposits, withdrawals, plans, blog, team, testimonials, faq, contacts, settings
│   └── *.ejs                     # index, about, plans, faq, blog, blog-single, privacy, terms, 404, 500
├── public/
│   ├── css/style.css
│   ├── js/main.js
│   ├── images/                   # Place hero1-4.jpg and about1.jpg here
│   └── uploads/                  # User-uploaded files (auto-created)
└── logs/                         # Winston log files (auto-created)
```

---

## ⚙️ Installation

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set MONGODB_URI, SESSION_SECRET (64-byte hex), SMTP settings

# 3. Generate a secure SESSION_SECRET
node -e "require('crypto').randomBytes(64).toString('hex').then ? '' : console.log(require('crypto').randomBytes(64).toString('hex'))"

# 4. Seed the database
node seed.js

# 5. Development
npm run dev

# 6. Production
npm start
```

---

## 🔑 Environment Variables

```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/lucrativeetf
SESSION_SECRET=<64-byte-hex-string>
APP_URL=https://yourdomain.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password
SMTP_NAME=LucrativeETF
# Optional — override seed credentials
SEED_ADMIN_EMAIL=admin@yourdomain.com
SEED_ADMIN_PASS=YourSecureAdminPass!
```

---

## 🗺️ Routes Overview

### Public
| Route | Description |
|---|---|
| `GET /` | Homepage |
| `GET /plans` | Investment plans |
| `GET /blog` | Blog listing |
| `GET /faq` | FAQ page |
| `GET /privacy` | Privacy policy |
| `GET /terms` | Terms & conditions |
| `POST /contact` | Contact form (rate-limited) |
| `GET /health` | Health check endpoint |

### Auth (guest only, rate-limited)
| Route | Description |
|---|---|
| `GET/POST /auth/login` | Login with brute-force protection |
| `GET/POST /auth/register` | Register |
| `GET /auth/logout` | Logout (session destroy) |
| `GET/POST /auth/forgot-password` | Password reset request |
| `GET/POST /auth/reset-password` | Password reset (1-hr token) |

### Dashboard (auth required)
| Route | Description |
|---|---|
| `GET /dashboard` | Dashboard overview |
| `GET/POST /dashboard/invest` | Choose & invest (atomic balance deduction) |
| `GET/POST /dashboard/deposit` | Deposit funds + sending wallet field |
| `GET/POST /dashboard/withdraw` | Withdraw funds |
| `GET /dashboard/transactions` | Full transaction history |
| `GET/POST /dashboard/profile` | Edit profile |
| `POST /dashboard/change-password` | Change password |
| `POST /dashboard/wallets` | Save wallet address |

### Admin (admin role required)
| Route | Description |
|---|---|
| `GET /admin` | Admin dashboard |
| `GET /admin/users` | Manage users (credit/toggle/delete) |
| `GET /admin/deposits` | Approve/reject deposits |
| `GET /admin/withdrawals` | Approve/reject withdrawals (auto-refund on reject) |
| `GET /admin/plans` | Manage investment plans |
| `GET /admin/blog` | Manage blog posts |
| `GET /admin/team` | Manage team members |
| `GET /admin/testimonials` | Manage testimonials |
| `GET /admin/faq` | Manage FAQs |
| `GET /admin/contacts` | View contact messages |
| `GET/POST /admin/settings` | Site settings |

---

## 🖼️ Required Images

Place these in `public/images/`:
- `hero1.jpg`, `hero2.jpg`, `hero3.jpg`, `hero4.jpg` — hero carousel backgrounds
- `about1.jpg` — about section image
- `favicon.png` — browser favicon

---

## 🌐 Nginx Reverse Proxy (Production)

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    client_max_body_size 6M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /public/ {
        alias /var/www/bywitinvest/public/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

## 🔄 PM2 Process Manager

```bash
npm install -g pm2
pm2 start app.js --name "lucrativeetf" --max-memory-restart 500M
pm2 save
pm2 startup
```

---

## ⚠️ Post-Deployment Checklist

- [ ] Change admin password immediately after first login
- [ ] Set a real 64-byte random `SESSION_SECRET` in `.env`
- [ ] Configure SMTP credentials for password reset emails
- [ ] Add actual hero and about images to `public/images/`
- [ ] Set crypto wallet addresses in Admin → Settings
- [ ] Enable HTTPS (cert via Let's Encrypt)
- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Review and update Privacy Policy and Terms of Service content
- [ ] Set up MongoDB backups (Atlas automated backups or `mongodump` cron)
- [ ] Monitor logs in `logs/` directory

---

## 📝 License
All rights reserved.
