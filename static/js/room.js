/**
 * room.js
 * Lógica de la sala activa de videoconferencia:
 * - Streaming de audio y video local con WebRTC
 * - Controles de periféricos (Mute / Cámara On/Off)
 * - Compartir pantalla
 * - Paneles de participantes y chat
 * - Reloj en tiempo real
 */

class MeetingRoom {
  constructor(options) {
    this.meetingCode = options.meetingCode;
    this.userName = options.userName;
    this.isHost = options.isHost;

    this.localStream = null;
    this.screenStream = null;
    this.isMuted = false;
    this.isVideoOff = false;
    this.isScreenSharing = false;
    this.isHandRaised = false;

    this.localVideo = document.getElementById('localVideo');
    this.localAvatar = document.getElementById('localAvatar');
    this.btnMic = document.getElementById('btnToggleMic');
    this.btnCam = document.getElementById('btnToggleCam');
    this.btnScreen = document.getElementById('btnToggleScreen');
    this.btnHand = document.getElementById('btnToggleHand');
    this.btnLeave = document.getElementById('btnLeaveCall');
    this.btnParticipants = document.getElementById('btnParticipantsPanel');
    this.btnChat = document.getElementById('btnChatPanel');

    this.participantsPanel = document.getElementById('participantsPanel');
    this.chatPanel = document.getElementById('chatPanel');

    this.init();
  }

  async init() {
    this.initClock();
    this.bindEvents();
    await this.startMedia();
  }

  initClock() {
    const clockEl = document.getElementById('roomClock');
    const updateTime = () => {
      const now = new Date();
      if (clockEl) {
        clockEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  bindEvents() {
    if (this.btnMic) {
      this.btnMic.addEventListener('click', () => this.toggleMic());
    }

    if (this.btnCam) {
      this.btnCam.addEventListener('click', () => this.toggleCam());
    }

    if (this.btnScreen) {
      this.btnScreen.addEventListener('click', () => this.toggleScreenShare());
    }

    if (this.btnHand) {
      this.btnHand.addEventListener('click', () => this.toggleHandRaise());
    }

    if (this.btnLeave) {
      this.btnLeave.addEventListener('click', () => this.leaveCall());
    }

    if (this.btnParticipants) {
      this.btnParticipants.addEventListener('click', () => this.togglePanel(this.participantsPanel));
    }

    if (this.btnChat) {
      this.btnChat.addEventListener('click', () => this.togglePanel(this.chatPanel));
    }

    // Cerrar paneles con botón 'X'
    document.querySelectorAll('.btn-close-side-panel').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.participantsPanel) this.participantsPanel.classList.remove('show');
        if (this.chatPanel) this.chatPanel.classList.remove('show');
      });
    });

    // Envío de mensajes de chat en sala
    const chatInput = document.getElementById('roomChatInput');
    const chatBtn = document.getElementById('btnSendChatMessage');
    if (chatBtn && chatInput) {
      chatBtn.addEventListener('click', () => this.sendChatMessage());
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendChatMessage();
      });
    }
  }

  async startMedia() {
    try {
      const constraints = {
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (this.localVideo) {
        this.localVideo.srcObject = this.localStream;
        this.localVideo.style.display = 'block';
      }
      if (this.localAvatar) {
        this.localAvatar.style.display = 'none';
      }
    } catch (err) {
      console.warn("No se pudo iniciar video/audio local:", err);
      // Mostrar avatar si el usuario no tiene cámara o denegó permisos
      if (this.localVideo) this.localVideo.style.display = 'none';
      if (this.localAvatar) this.localAvatar.style.display = 'flex';
      this.isVideoOff = true;
      if (this.btnCam) this.btnCam.classList.add('off');
    }
  }

  toggleMic() {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.isMuted = !this.isMuted;
      audioTrack.enabled = !this.isMuted;
      this.btnMic.classList.toggle('off', this.isMuted);

      const micIcon = document.getElementById('micIconSpan');
      if (micIcon) {
        micIcon.innerText = this.isMuted ? 'mic_off' : 'mic';
      }

      const tileBadge = document.getElementById('localMicBadge');
      if (tileBadge) {
        tileBadge.classList.toggle('muted', this.isMuted);
        tileBadge.innerHTML = this.isMuted ? '🔇' : '🎙️';
      }
    }
  }

  toggleCam() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      this.isVideoOff = !this.isVideoOff;
      videoTrack.enabled = !this.isVideoOff;
      this.btnCam.classList.toggle('off', this.isVideoOff);

      const camIcon = document.getElementById('camIconSpan');
      if (camIcon) {
        camIcon.innerText = this.isVideoOff ? 'videocam_off' : 'videocam';
      }

      if (this.localVideo && this.localAvatar) {
        this.localVideo.style.display = this.isVideoOff ? 'none' : 'block';
        this.localAvatar.style.display = this.isVideoOff ? 'flex' : 'none';
      }
    }
  }

  async toggleScreenShare() {
    if (!this.isScreenSharing) {
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        this.isScreenSharing = true;
        this.btnScreen.classList.add('active');

        // Escuchar cuando el usuario detiene la pantalla desde la barra del navegador
        this.screenStream.getVideoTracks()[0].onended = () => {
          this.stopScreenShare();
        };

        // Crear o actualizar baldosa de pantalla compartida
        this.addScreenShareTile(this.screenStream);
      } catch (err) {
        console.warn("Pantalla compartida cancelada:", err);
      }
    } else {
      this.stopScreenShare();
    }
  }

  stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    this.isScreenSharing = false;
    if (this.btnScreen) this.btnScreen.classList.remove('active');

    const screenTile = document.getElementById('screenShareTile');
    if (screenTile) screenTile.remove();
  }

  addScreenShareTile(stream) {
    const grid = document.querySelector('.room-video-grid');
    if (!grid) return;

    let tile = document.getElementById('screenShareTile');
    if (!tile) {
      tile = document.createElement('div');
      tile.id = 'screenShareTile';
      tile.className = 'video-tile';
      tile.innerHTML = `
        <video autoplay playsinline></video>
        <div class="tile-overlay-bottom">
          <span>Tu pantalla (presentando)</span>
        </div>
      `;
      grid.prepend(tile);
    }
    const video = tile.querySelector('video');
    video.srcObject = stream;
    video.style.transform = 'none'; // No invertir la pantalla
  }

  toggleHandRaise() {
    this.isHandRaised = !this.isHandRaised;
    this.btnHand.classList.toggle('active', this.isHandRaised);

    const handBadge = document.getElementById('localHandBadge');
    if (handBadge) {
      handBadge.style.display = this.isHandRaised ? 'flex' : 'none';
    }
  }

  togglePanel(panelToToggle) {
    const isAlreadyOpen = panelToToggle.classList.contains('show');
    if (this.participantsPanel) this.participantsPanel.classList.remove('show');
    if (this.chatPanel) this.chatPanel.classList.remove('show');

    if (!isAlreadyOpen) {
      panelToToggle.classList.add('show');
    }
  }

  sendChatMessage() {
    const input = document.getElementById('roomChatInput');
    const list = document.getElementById('roomChatMessages');
    if (!input || !list) return;

    const text = input.value.trim();
    if (!text) return;

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgEl = document.createElement('div');
    msgEl.style.marginBottom = '12px';
    msgEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 2px;">
        <strong style="color: #8ab4f8;">${this.userName} (Tú)</strong>
        <span style="color: #9aa0a6;">${now}</span>
      </div>
      <div style="background-color: #3c4043; padding: 8px 12px; border-radius: 8px; font-size: 14px; word-break: break-word;">
        ${document.createElement('div').appendChild(document.createTextNode(text)).parentNode.innerHTML}
      </div>
    `;
    list.appendChild(msgEl);
    input.value = '';
    list.scrollTop = list.scrollHeight;
  }

  leaveCall() {
    if (confirm("¿Deseas salir de la reunión?")) {
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
      }
      if (this.screenStream) {
        this.screenStream.getTracks().forEach(t => t.stop());
      }
      window.location.href = '/';
    }
  }
}

window.MeetingRoom = MeetingRoom;
