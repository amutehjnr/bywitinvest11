/* LucrativeETF – Main JS (Production v2) */

document.addEventListener('DOMContentLoaded', function () {

  // ── Navbar scroll effect ──────────────────────────────
  const navbar = document.getElementById('mainNav');
  if (navbar) {
    const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ── Sidebar mobile toggle ─────────────────────────────
  const toggleBtn = document.querySelector('.sidebar-toggle');
  const sidebar   = document.querySelector('.dashboard-sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (!sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // ── Auto-dismiss alerts ───────────────────────────────
  document.querySelectorAll('.alert:not(.alert-permanent)').forEach(alert => {
    setTimeout(() => {
      alert.style.transition = 'opacity 0.5s';
      alert.style.opacity    = '0';
      setTimeout(() => alert.remove(), 500);
    }, 6000);
  });

  // ── Smooth scroll for anchor links ───────────────────
  document.querySelectorAll('a[href^="/#"]').forEach(link => {
    link.addEventListener('click', function (e) {
      const target = this.getAttribute('href').replace('/', '');
      if (window.location.pathname === '/') {
        e.preventDefault();
        const el = document.querySelector(target);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          const navCollapse = document.getElementById('navbarNav');
          if (navCollapse && navCollapse.classList.contains('show')) {
            new bootstrap.Collapse(navCollapse).hide();
          }
        }
      }
    });
  });

  // ── Scroll animation ──────────────────────────────────
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate__animated', 'animate__fadeInUp');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll(
      '.plan-card, .service-card, .testimonial-card, .blog-card, .about-card, .why-card, .stat-card'
    ).forEach(el => observer.observe(el));
  }

  // ── Confirm delete / sensitive forms ─────────────────
  document.querySelectorAll('form[data-confirm]').forEach(form => {
    form.addEventListener('submit', (e) => {
      if (!confirm(form.dataset.confirm || 'Are you sure?')) e.preventDefault();
    });
  });

  // ── Copy wallet address ───────────────────────────────
  document.querySelectorAll('code[data-copy]').forEach(el => {
    el.style.cursor = 'pointer';
    el.title = 'Click to copy';
    el.addEventListener('click', () => {
      const text = el.textContent.trim();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => showCopyFeedback(el));
      } else {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity  = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        try { document.execCommand('copy'); showCopyFeedback(el); } catch (_) {}
        document.body.removeChild(ta);
      }
    });
  });

  function showCopyFeedback(el) {
    const orig = el.textContent;
    el.textContent = '✓ Copied!';
    setTimeout(() => { el.textContent = orig; }, 1500);
  }

  // ── Password strength indicator ───────────────────────
  document.querySelectorAll('input[name="password"], input[name="newPassword"]').forEach(input => {
    // Skip if there's already a strength indicator sibling
    if (input.parentNode.nextElementSibling?.classList.contains('pwd-strength')) return;
    const indicator = document.createElement('div');
    indicator.className = 'pwd-strength mt-1';
    input.parentNode.insertAdjacentElement('afterend', indicator);
    input.addEventListener('input', () => {
      const v = input.value;
      let s = 0;
      if (v.length >= 8) s++;
      if (v.length >= 12) s++;
      if (/[A-Z]/.test(v)) s++;
      if (/[0-9]/.test(v)) s++;
      if (/[^A-Za-z0-9]/.test(v)) s++;
      const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
      const colors = ['', '#e74c3c', '#f0a500', '#3498db', '#1a9e5f', '#0d6e46'];
      indicator.innerHTML = v
        ? `<small style="color:${colors[s]};font-weight:600">${labels[s]}</small>`
        : '';
    });
  });

  // ── CSRF token helper for fetch requests ──────────────
  window.getCsrfToken = () => {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  };

});
