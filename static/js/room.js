/**
 * room.js
 * Lógica integral de videoconferencia multiusuario en tiempo real:
 * - Streaming de audio y video bidireccional WebRTC Mesh (PeerJS + STUN)
 * - Conexión automática y dinámica entre todos los participantes en la sala
 * - Cuadrícula responsiva de video estilo Google Meet
 * - Controles de periféricos (Mute / Cámara On/Off) con difusión de estado
 * - Compartición de pantalla transmitida a todos los participantes
 * - Chat de sala en tiempo real y sincronizado con base de datos
 * - Lista de participantes en vivo con indicador de presencia y mano levantada
 * - Salida limpia de la reunión
 */

class MeetingRoom {
  constructor(options) {
    this.meetingCode = options.meetingCode;
    this.userId = options.userId;
    this.userName = options.userName;
    this.userInitial = options.userInitial || (this.userName ? this.userName.charAt(0).toUpperCase() : 'U');
    this.isHost = options.isHost;

    // Identificador único para el peer WebRTC
    const cleanCode = this.meetingCode.replace(/[^a-zA-Z0-9]/g, '');
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    this.peerId = `telemeet-${cleanCode}-${this.userId}-${randomSuffix}`;

    this.localStream = null;
    this.screenStream = null;
    this.isMuted = false;
    this.isVideoOff = false;
    this.isScreenSharing = false;
    this.isHandRaised = false;

    // Diccionario de conexiones remotas: { [peerId]: { call, dataConn, stream, element, info } }
    this.peers = {};
    this.lastChatId = 0;
    this.activeParticipants = [];
    this.heartbeatTimer = null;
    this.chatTimer = null;

    // Elementos DOM
    this.videoGrid = document.getElementById('roomVideoGrid');
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
    this.participantsCountEl = document.getElementById('participantsCount');
    this.participantsListContainer = document.getElementById('activeParticipantsListContainer');
    this.chatMessagesContainer = document.getElementById('roomChatMessages');

    this.init();
  }

  async init() {
    this.initClock();
    this.bindEvents();
    await this.startMedia();
    this.initWebRTC();
    this.startHeartbeat();
    this.startChatPolling();

    // Notificar al servidor al cerrar pestaña
    window.addEventListener('beforeunload', () => {
      this.notifyLeave();
    });
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
    const savedMic = localStorage.getItem('telemeet_mic');
    const savedCam = localStorage.getItem('telemeet_cam');
    this.isMuted = sessionStorage.getItem('telemeet_prejoin_mic_muted') === 'true';
    this.isVideoOff = sessionStorage.getItem('telemeet_prejoin_cam_off') === 'true';

    const constraints = {
      video: savedCam ? { deviceId: { exact: savedCam } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: savedMic ? { deviceId: { exact: savedMic } } : true
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.applyInitialMediaState();
      if (this.localVideo) {
        this.localVideo.srcObject = this.localStream;
        this.localVideo.style.display = this.isVideoOff ? 'none' : 'block';
      }
      if (this.localAvatar) {
        this.localAvatar.style.display = this.isVideoOff ? 'flex' : 'none';
      }
      this.updateControlState();
    } catch (err) {
      console.warn("No se pudo iniciar video/audio local:", err);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        this.applyInitialMediaState();
        if (this.localVideo) this.localVideo.srcObject = this.localStream;
        if (this.localVideo) this.localVideo.style.display = this.isVideoOff ? 'none' : 'block';
        if (this.localAvatar) this.localAvatar.style.display = this.isVideoOff ? 'flex' : 'none';
        this.updateControlState();
      } catch (fallbackErr) {
        console.warn("Tampoco se pudo iniciar el dispositivo predeterminado:", fallbackErr);
        if (this.localVideo) this.localVideo.style.display = 'none';
        if (this.localAvatar) this.localAvatar.style.display = 'flex';
        this.isVideoOff = true;
        if (this.btnCam) this.btnCam.classList.add('off');

        // Intentar al menos obtener audio si la cámara falló
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (audioErr) {
          console.warn("Tampoco se pudo capturar audio:", audioErr);
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const dst = osc.connect(ctx.createMediaStreamDestination());
          osc.start();
          const silentTrack = dst.stream.getAudioTracks()[0];
          silentTrack.enabled = false;
          this.localStream = new MediaStream([silentTrack]);
          this.isMuted = true;
        }
      }
    }
  }

  applyInitialMediaState() {
    const audioTrack = this.localStream && this.localStream.getAudioTracks()[0];
    const videoTrack = this.localStream && this.localStream.getVideoTracks()[0];
    if (audioTrack) audioTrack.enabled = !this.isMuted;
    if (videoTrack) videoTrack.enabled = !this.isVideoOff;
  }

  updateControlState() {
    if (this.btnMic) this.btnMic.classList.toggle('off', this.isMuted);
    if (this.btnCam) this.btnCam.classList.toggle('off', this.isVideoOff);
  }

  /* ==========================================================================
     MOTOR WEBRTC (PEERJS + STUN)
     ========================================================================== */
  initWebRTC() {
    if (typeof Peer === 'undefined') {
      console.warn("Librería PeerJS no disponible, operando en modo local.");
      return;
    }

    try {
      this.peer = new Peer(this.peerId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        console.log("WebRTC Peer registrado con ID:", id);
        this.sendHeartbeat();
      });

      // Escuchar llamadas entrantes de otros participantes
      this.peer.on('call', (call) => {
        console.log("Llamada WebRTC entrante de:", call.peer);
        call.answer(this.localStream);

        call.on('stream', (remoteStream) => {
          this.handleIncomingRemoteStream(call.peer, remoteStream, call.metadata);
        });

        call.on('close', () => {
          this.removeRemoteVideoTile(call.peer);
        });

        call.on('error', (err) => {
          console.warn("Error en llamada peer:", err);
        });

        if (!this.peers[call.peer]) {
          this.peers[call.peer] = {};
        }
        this.peers[call.peer].call = call;
      });

      // Escuchar conexiones de datos (Chat y eventos P2P instantáneos)
      this.peer.on('connection', (conn) => {
        this.setupDataConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.warn("Aviso de WebRTC Peer:", err.type, err);
      });

    } catch (err) {
      console.error("Error al inicializar PeerJS:", err);
    }
  }

  setupDataConnection(conn) {
    if (!this.peers[conn.peer]) {
      this.peers[conn.peer] = {};
    }
    this.peers[conn.peer].dataConn = conn;

    conn.on('data', (data) => {
      if (!data) return;
      if (data.type === 'CHAT_MESSAGE') {
        this.appendChatMessage(data.message, false);
      } else if (data.type === 'HAND_RAISE') {
        this.updateParticipantHand(conn.peer, data.isRaised);
      } else if (data.type === 'MEDIA_STATE') {
        this.updateRemoteMediaState(conn.peer, data);
      }
    });
  }

  // Establecer conexión con otro participante
  connectToPeer(remotePeerId, remoteInfo) {
    if (!this.peer || !this.peer.open || remotePeerId === this.peerId) return;
    if (this.peers[remotePeerId] && this.peers[remotePeerId].call) return;

    console.log("Iniciando llamada WebRTC saliente hacia:", remotePeerId);
    const call = this.peer.call(remotePeerId, this.localStream, {
      metadata: {
        userId: this.userId,
        userName: this.userName,
        userInitial: this.userInitial
      }
    });

    if (!this.peers[remotePeerId]) {
      this.peers[remotePeerId] = {};
    }
    this.peers[remotePeerId].call = call;
    this.peers[remotePeerId].info = remoteInfo;

    call.on('stream', (remoteStream) => {
      this.handleIncomingRemoteStream(remotePeerId, remoteStream, remoteInfo);
    });

    call.on('close', () => {
      this.removeRemoteVideoTile(remotePeerId);
    });

    call.on('error', (err) => {
      console.warn("Error en llamada con peer:", remotePeerId, err);
    });

    // Conectar canal de datos P2P
    try {
      const conn = this.peer.connect(remotePeerId);
      this.setupDataConnection(conn);
    } catch (e) {
      console.warn("No se pudo abrir DataChannel con:", remotePeerId, e);
    }
  }

  handleIncomingRemoteStream(peerId, remoteStream, metadata) {
    console.log("Recibido stream remoto de:", peerId);
    if (!this.peers[peerId]) {
      this.peers[peerId] = {};
    }
    this.peers[peerId].stream = remoteStream;
    this.createOrUpdateRemoteVideoTile(peerId, remoteStream, metadata);
  }

  /* ==========================================================================
     GESTIÓN DE BALDOSAS DE VIDEO (GRID DINÁMICO)
     ========================================================================== */
  createOrUpdateRemoteVideoTile(peerId, stream, metadata) {
    let tile = document.getElementById(`tile-${peerId}`);
    const name = metadata?.displayName || metadata?.userName || metadata?.name || `Participante (${peerId.slice(-4)})`;
    const initial = metadata?.userInitial || name.charAt(0).toUpperCase();

    if (!tile) {
      tile = document.createElement('div');
      tile.id = `tile-${peerId}`;
      tile.className = 'video-tile remote-tile';
      tile.innerHTML = `
        <video id="video-${peerId}" autoplay playsinline></video>
        <div id="avatar-${peerId}" class="video-tile-placeholder" style="display: none;">
          <div class="participant-avatar-large" style="background: linear-gradient(135deg, #10b981, #059669);">
            ${this.escapeHtml(initial)}
          </div>
        </div>
        <div class="tile-overlay-bottom">
          <span>${this.escapeHtml(name)}</span>
        </div>
        <div class="tile-overlay-top-right">
          <div class="tile-icon-badge" id="mic-badge-${peerId}" title="Micrófono">🎙️</div>
          <div class="tile-icon-badge" id="hand-badge-${peerId}" style="display: none;" title="Mano levantada">✋</div>
        </div>
      `;

      if (this.videoGrid) {
        this.videoGrid.appendChild(tile);
      }
    }

    const videoEl = tile.querySelector('video');
    if (videoEl && stream) {
      videoEl.srcObject = stream;
      videoEl.play().catch(e => console.warn("AutoPlay remoto requirió interacción:", e));
    }

    this.updateGridCSS();
  }

  removeRemoteVideoTile(peerId) {
    const tile = document.getElementById(`tile-${peerId}`);
    if (tile) {
      tile.remove();
    }
    delete this.peers[peerId];
    this.updateGridCSS();
  }

  updateGridCSS() {
    if (!this.videoGrid) return;
    const tiles = this.videoGrid.querySelectorAll('.video-tile');
    const count = tiles.length;

    if (count === 1) {
      this.videoGrid.style.gridTemplateColumns = '1fr';
      this.videoGrid.style.maxWidth = '900px';
      this.videoGrid.style.margin = '0 auto';
    } else if (count === 2) {
      this.videoGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
      this.videoGrid.style.maxWidth = '100%';
    } else if (count <= 4) {
      this.videoGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
      this.videoGrid.style.maxWidth = '100%';
    } else if (count <= 6) {
      this.videoGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
      this.videoGrid.style.maxWidth = '100%';
    } else {
      this.videoGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
      this.videoGrid.style.maxWidth = '100%';
    }
  }

  /* ==========================================================================
     CONTROLES DE PERIFÉRICOS LOCALES
     ========================================================================== */
  toggleMic() {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.isMuted = !this.isMuted;
      audioTrack.enabled = !this.isMuted;
      this.btnMic.classList.toggle('off', this.isMuted);

      const tileBadge = document.getElementById('localMicBadge');
      if (tileBadge) {
        tileBadge.classList.toggle('muted', this.isMuted);
        tileBadge.innerHTML = this.isMuted ? '🔇' : '🎙️';
      }

      this.broadcastMediaState();
      this.sendHeartbeat();
    }
  }

  toggleCam() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      this.isVideoOff = !this.isVideoOff;
      videoTrack.enabled = !this.isVideoOff;
      this.btnCam.classList.toggle('off', this.isVideoOff);

      if (this.localVideo && this.localAvatar) {
        this.localVideo.style.display = this.isVideoOff ? 'none' : 'block';
        this.localAvatar.style.display = this.isVideoOff ? 'flex' : 'none';
      }

      this.broadcastMediaState();
      this.sendHeartbeat();
    }
  }

  async toggleScreenShare() {
    if (!this.isScreenSharing) {
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        this.isScreenSharing = true;
        this.btnScreen.classList.add('active');

        const screenTrack = this.screenStream.getVideoTracks()[0];

        // Reemplazar la pista de video en todas las llamadas activas con los pares
        this.replaceOutgoingVideoTrack(screenTrack);

        // Mostrar pantalla localmente
        if (this.localVideo) {
          this.localVideo.srcObject = this.screenStream;
          this.localVideo.style.transform = 'none';
        }

        screenTrack.onended = () => {
          this.stopScreenShare();
        };
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

    // Restaurar video de cámara
    if (this.localStream) {
      const cameraTrack = this.localStream.getVideoTracks()[0];
      if (cameraTrack) {
        this.replaceOutgoingVideoTrack(cameraTrack);
      }
      if (this.localVideo) {
        this.localVideo.srcObject = this.localStream;
        this.localVideo.style.transform = 'scaleX(-1)';
        this.localVideo.style.display = this.isVideoOff ? 'none' : 'block';
      }
    }
  }

  replaceOutgoingVideoTrack(newTrack) {
    Object.values(this.peers).forEach(peerObj => {
      if (peerObj.call && peerObj.call.peerConnection) {
        const senders = peerObj.call.peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(newTrack).catch(e => console.warn("Error al reemplazar track de video:", e));
        }
      }
    });
  }

  toggleHandRaise() {
    this.isHandRaised = !this.isHandRaised;
    this.btnHand.classList.toggle('active', this.isHandRaised);

    const handBadge = document.getElementById('localHandBadge');
    if (handBadge) {
      handBadge.style.display = this.isHandRaised ? 'flex' : 'none';
    }

    this.broadcastData({
      type: 'HAND_RAISE',
      isRaised: this.isHandRaised
    });
    this.sendHeartbeat();
  }

  broadcastMediaState() {
    this.broadcastData({
      type: 'MEDIA_STATE',
      isAudioMuted: this.isMuted,
      isVideoMuted: this.isVideoOff
    });
  }

  broadcastData(dataObj) {
    Object.values(this.peers).forEach(p => {
      if (p.dataConn && p.dataConn.open) {
        p.dataConn.send(dataObj);
      }
    });
  }

  updateParticipantHand(peerId, isRaised) {
    const badge = document.getElementById(`hand-badge-${peerId}`);
    if (badge) {
      badge.style.display = isRaised ? 'flex' : 'none';
    }
  }

  updateRemoteMediaState(peerId, state) {
    const micBadge = document.getElementById(`mic-badge-${peerId}`);
    if (micBadge) {
      micBadge.innerHTML = state.isAudioMuted ? '🔇' : '🎙️';
      micBadge.classList.toggle('muted', state.isAudioMuted);
    }
    const avatar = document.getElementById(`avatar-${peerId}`);
    const video = document.getElementById(`video-${peerId}`);
    if (avatar && video) {
      video.style.display = state.isVideoMuted ? 'none' : 'block';
      avatar.style.display = state.isVideoMuted ? 'flex' : 'none';
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

  /* ==========================================================================
     PRESENCIA Y HEARTBEAT DE PARTICIPANTES
     ========================================================================== */
  startHeartbeat() {
    this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 3000);
  }

  async sendHeartbeat() {
    try {
      const resp = await fetch(`/api/room/${this.meetingCode}/heartbeat/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': this.getCsrfToken()
        },
        body: JSON.stringify({
          peer_id: this.peerId,
          is_audio_muted: this.isMuted,
          is_video_muted: this.isVideoOff,
          is_hand_raised: this.isHandRaised
        })
      });

      if (!resp.ok) return;
      const data = await resp.json();

      if (data.participants) {
        this.activeParticipants = data.participants;
        this.updateParticipantsListUI(data.participants);

        // Conectar automáticamente con nuevos pares activos
        data.participants.forEach(p => {
          if (!p.is_me && p.peer_id && p.peer_id !== this.peerId) {
            // Regla para evitar doble conexión simultánea: inicia quien tenga menor peerId alfanumérico
            if (this.peerId < p.peer_id) {
              this.connectToPeer(p.peer_id, p);
            }
          }
        });
      }
    } catch (err) {
      console.warn("Error al enviar heartbeat:", err);
    }
  }

  updateParticipantsListUI(participants) {
    if (this.participantsCountEl) {
      this.participantsCountEl.innerText = participants.length;
    }

    if (this.participantsListContainer) {
      this.participantsListContainer.innerHTML = participants.map(p => {
        const initial = p.display_name ? p.display_name.charAt(0).toUpperCase() : 'U';
        const roleLabel = p.is_host ? 'Organizador / Host' : 'Participante Seguro';
        const meLabel = p.is_me ? ' (Tú)' : '';
        const micIcon = p.is_audio_muted ? '🔇' : '🎙️';
        const handIcon = p.is_hand_raised ? '<span style="margin-right: 6px;">✋</span>' : '';

        return `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #1e40af, #38bdf8); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #ffffff;">
                ${this.escapeHtml(initial)}
              </div>
              <div>
                <div style="font-size: 14px; font-weight: 600; color: #ffffff;">
                  ${this.escapeHtml(p.display_name)}${meLabel}
                </div>
                <div style="font-size: 11px; color: #38bdf8;">${roleLabel}</div>
              </div>
            </div>
            <div style="display: flex; align-items: center;">
              ${handIcon}
              <span>${micIcon}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  /* ==========================================================================
     CHAT EN TIEMPO REAL
     ========================================================================== */
  startChatPolling() {
    this.pollChatMessages();
    this.chatTimer = setInterval(() => this.pollChatMessages(), 2500);
  }

  async pollChatMessages() {
    try {
      const url = `/api/room/${this.meetingCode}/messages/?after_id=${this.lastChatId}`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();

      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => {
          this.appendChatMessage(msg, msg.is_me);
          if (msg.id > this.lastChatId) {
            this.lastChatId = msg.id;
          }
        });
      }
    } catch (err) {
      console.warn("Error en polling de chat:", err);
    }
  }

  async sendChatMessage() {
    const input = document.getElementById('roomChatInput');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    try {
      const resp = await fetch(`/api/room/${this.meetingCode}/messages/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': this.getCsrfToken()
        },
        body: JSON.stringify({ message: text })
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.success && data.message) {
          this.appendChatMessage(data.message, true);
          if (data.message.id > this.lastChatId) {
            this.lastChatId = data.message.id;
          }
          // Difundir también por canal de datos WebRTC instantáneo
          this.broadcastData({
            type: 'CHAT_MESSAGE',
            message: data.message
          });
        }
      }
    } catch (err) {
      console.warn("Error al enviar mensaje:", err);
    }
  }

  appendChatMessage(msg, isMe) {
    if (!this.chatMessagesContainer) return;
    if (document.getElementById(`chat-msg-${msg.id}`)) return;

    const msgEl = document.createElement('div');
    msgEl.id = `chat-msg-${msg.id}`;
    msgEl.style.marginBottom = '12px';

    const senderColor = isMe ? '#38bdf8' : '#34d399';
    const senderTitle = isMe ? `${msg.sender_name} (Tú)` : msg.sender_name;

    msgEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 2px;">
        <strong style="color: ${senderColor};">${this.escapeHtml(senderTitle)}</strong>
        <span style="color: #94a3b8;">${msg.time || ''}</span>
      </div>
      <div style="background-color: #12284c; border: 1px solid rgba(56, 189, 248, 0.15); padding: 8px 12px; border-radius: 8px; font-size: 13.5px; word-break: break-word; color: #ffffff;">
        ${this.escapeHtml(msg.message)}
      </div>
    `;

    this.chatMessagesContainer.appendChild(msgEl);
    this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
  }

  /* ==========================================================================
     SALIDA Y LIMPIEZA
     ========================================================================== */
  async notifyLeave() {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`/api/room/${this.meetingCode}/leave/`);
      } else {
        await fetch(`/api/room/${this.meetingCode}/leave/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': this.getCsrfToken()
          }
        });
      }
    } catch (e) {
      // ignore
    }
  }

  leaveCall() {
    if (confirm("¿Deseas salir de la reunión?")) {
      this.notifyLeave();

      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      if (this.chatTimer) clearInterval(this.chatTimer);

      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
      }
      if (this.screenStream) {
        this.screenStream.getTracks().forEach(t => t.stop());
      }
      if (this.peer) {
        this.peer.destroy();
      }
      window.location.href = '/';
    }
  }

  getCsrfToken() {
    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('csrftoken='))
      ?.split('=')[1];
    return cookieValue || '';
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
  }
}

window.MeetingRoom = MeetingRoom;
