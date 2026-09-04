/**
 * waiting-room.js
 * Gestión de la sala de espera y admisión de participantes ("Aceptar conexiones")
 * Funcionalidad clave requerida para el anfitrión y los invitados.
 */

class WaitingRoomManager {
  constructor(meetingCode, isHost, userStatus) {
    this.meetingCode = meetingCode;
    this.isHost = isHost;
    this.userStatus = userStatus;
    this.pollInterval = null;
    this.activeToast = null;

    this.init();
  }

  init() {
    if (this.isHost) {
      this.startHostPolling();
    } else if (this.userStatus === 'PENDING') {
      this.startGuestPolling();
    }
  }

  // Polling del anfitrión para detectar nuevos participantes esperando
  startHostPolling() {
    this.checkPendingRequests();
    this.pollInterval = setInterval(() => this.checkPendingRequests(), 3500);
  }

  async checkPendingRequests() {
    try {
      const resp = await fetch(`/api/waiting-room/${this.meetingCode}/pending/`);
      if (!resp.ok) return;
      const data = await resp.json();

      const badge = document.getElementById('pendingRequestsBadge');
      const container = document.getElementById('admissionsListContainer');

      if (data.requests && data.requests.length > 0) {
        if (badge) {
          badge.style.display = 'block';
          badge.innerText = data.requests.length;
        }

        // Mostrar notificación toast para el participante más reciente si no está mostrado
        const latest = data.requests[0];
        this.showAdmissionToast(latest);

        // Actualizar panel lateral de admisiones
        if (container) {
          container.innerHTML = data.requests.map(req => `
            <div class="admission-card" id="admission-card-${req.id}">
              <div class="admission-header">
                <strong>${this.escapeHtml(req.name)}</strong>
                <span style="font-size: 11px; color: #9aa0a6;">${req.requested_at}</span>
              </div>
              <div class="admission-actions">
                <button class="btn-deny" onclick="window.waitingRoomManager.handleAction(${req.id}, 'reject')">Denegar</button>
                <button class="btn-admit" onclick="window.waitingRoomManager.handleAction(${req.id}, 'accept')">Permitir</button>
              </div>
            </div>
          `).join('');
        }
      } else {
        if (badge) badge.style.display = 'none';
        if (container) {
          container.innerHTML = '<p style="font-size: 13px; color: #9aa0a6; text-align: center;">No hay solicitudes pendientes.</p>';
        }
        if (this.activeToast) {
          this.activeToast.remove();
          this.activeToast = null;
        }
      }
    } catch (err) {
      console.warn("Error al verificar solicitudes:", err);
    }
  }

  showAdmissionToast(req) {
    if (document.getElementById(`toast-req-${req.id}`)) return;

    if (this.activeToast) this.activeToast.remove();

    const toast = document.createElement('div');
    toast.id = `toast-req-${req.id}`;
    toast.className = 'admission-toast-notification';
    toast.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">👋</span>
        <div>
          <strong style="font-size: 14px;">${this.escapeHtml(req.name)}</strong>
          <div style="font-size: 12px; color: #bdc1c6;">quiere unirse a esta llamada</div>
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn-deny" onclick="window.waitingRoomManager.handleAction(${req.id}, 'reject')">Denegar</button>
        <button class="btn-admit" onclick="window.waitingRoomManager.handleAction(${req.id}, 'accept')">Permitir</button>
      </div>
    `;

    document.body.appendChild(toast);
    this.activeToast = toast;

    // Reproducir un aviso sutil
    if (window.deviceManager && window.deviceManager.playTestSound) {
      window.deviceManager.playTestSound();
    }
  }

  async handleAction(requestId, action) {
    try {
      const resp = await fetch(`/api/waiting-room/${this.meetingCode}/action/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': this.getCsrfToken()
        },
        body: JSON.stringify({ request_id: requestId, action: action })
      });
      const data = await resp.json();
      if (data.success) {
        const toast = document.getElementById(`toast-req-${requestId}`);
        if (toast) toast.remove();
        this.checkPendingRequests();
      }
    } catch (err) {
      alert("Error al procesar solicitud: " + err);
    }
  }

  // Polling del invitado esperando en la sala de espera
  startGuestPolling() {
    this.pollInterval = setInterval(async () => {
      try {
        const resp = await fetch(`/api/waiting-room/${this.meetingCode}/status/`);
        if (!resp.ok) return;
        const data = await resp.json();

        if (data.is_accepted) {
          clearInterval(this.pollInterval);
          // Recargar para entrar a la sala con permisos
          window.location.reload();
        } else if (data.is_rejected) {
          clearInterval(this.pollInterval);
          const container = document.getElementById('waitingScreen');
          if (container) {
            container.innerHTML = `
              <div class="waiting-room-container">
                <div style="font-size: 48px; margin-bottom: 16px;">🚫</div>
                <h2 style="font-size: 22px; margin-bottom: 8px;">Acceso denegado</h2>
                <p style="color: #9aa0a6; margin-bottom: 24px;">El anfitrión no ha permitido el acceso a esta reunión.</p>
                <a href="/" class="btn-card-start" style="text-decoration:none;">Regresar a Inicio</a>
              </div>
            `;
          }
        }
      } catch (err) {
        console.warn("Error en polling de sala de espera:", err);
      }
    }, 2500);
  }

  getCsrfToken() {
    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('csrftoken='))
      ?.split('=')[1];
    return cookieValue || '';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
  }
}

window.WaitingRoomManager = WaitingRoomManager;
