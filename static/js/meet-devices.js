/**
 * meet-devices.js
 * Gestión de periféricos (micrófono, bocina y cámara)
 * WebRTC MediaDevices, vúmetro de audio y pruebas de sonido
 * Compatible exactamente con el modal de Configuración (Imagen 2)
 */

class DeviceManager {
  constructor() {
    this.audioInputSelect = document.getElementById('micSelect');
    this.audioOutputSelect = document.getElementById('speakerSelect');
    this.videoInputSelect = document.getElementById('cameraSelect');
    
    this.audioMeterDots = document.querySelectorAll('.meter-dot');
    this.testSpeakerBtn = document.getElementById('testSpeakerBtn');
    this.videoPreview = document.getElementById('settingsVideoPreview');
    this.videoPlaceholder = document.getElementById('videoPreviewPlaceholder');
    
    this.audioStream = null;
    this.videoStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.animationFrameId = null;
    
    this.isMuted = false;
    this.isVideoOff = false;
    
    this.init();
  }

  async init() {
    this.bindEvents();
    // Cargar dispositivos al iniciar
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.ondevicechange = () => this.loadDevices();
    }
  }

  bindEvents() {
    if (this.testSpeakerBtn) {
      this.testSpeakerBtn.addEventListener('click', () => this.playTestSound());
    }

    if (this.audioInputSelect) {
      this.audioInputSelect.addEventListener('change', () => {
        const deviceId = this.audioInputSelect.value;
        localStorage.setItem('telemeet_mic', deviceId);
        this.startAudioMeter(deviceId);
      });
    }

    if (this.audioOutputSelect) {
      this.audioOutputSelect.addEventListener('change', () => {
        const deviceId = this.audioOutputSelect.value;
        localStorage.setItem('telemeet_speaker', deviceId);
      });
    }

    if (this.videoInputSelect) {
      this.videoInputSelect.addEventListener('change', () => {
        const deviceId = this.videoInputSelect.value;
        localStorage.setItem('telemeet_cam', deviceId);
        this.startCameraPreview(deviceId);
      });
    }
  }

  async requestPermissions() {
    try {
      // Solicita acceso para que el navegador revele las etiquetas de los periféricos
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      // Detener los tracks temporales de prueba
      stream.getTracks().forEach(track => track.stop());
      await this.loadDevices();
      return true;
    } catch (err) {
      console.warn("Permisos de periféricos no otorgados o no disponibles:", err);
      await this.loadDevices();
      return false;
    }
  }

  async loadDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      console.warn("MediaDevices API no soportada en este navegador.");
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      if (this.audioInputSelect) this.audioInputSelect.innerHTML = '';
      if (this.audioOutputSelect) this.audioOutputSelect.innerHTML = '';
      if (this.videoInputSelect) this.videoInputSelect.innerHTML = '';

      let audioInCount = 0;
      let audioOutCount = 0;
      let videoInCount = 0;

      const savedMic = localStorage.getItem('telemeet_mic');
      const savedSpeaker = localStorage.getItem('telemeet_speaker');
      const savedCam = localStorage.getItem('telemeet_cam');

      devices.forEach((device) => {
        const option = document.createElement('option');
        option.value = device.deviceId;

        if (device.kind === 'audioinput') {
          audioInCount++;
          option.text = device.label || `Micrófono ${audioInCount}`;
          if (savedMic === device.deviceId) option.selected = true;
          if (this.audioInputSelect) this.audioInputSelect.appendChild(option);
        } else if (device.kind === 'audiooutput') {
          audioOutCount++;
          option.text = device.label || `Bocina ${audioOutCount}`;
          if (savedSpeaker === device.deviceId) option.selected = true;
          if (this.audioOutputSelect) this.audioOutputSelect.appendChild(option);
        } else if (device.kind === 'videoinput') {
          videoInCount++;
          option.text = device.label || `Cámara ${videoInCount}`;
          if (savedCam === device.deviceId) option.selected = true;
          if (this.videoInputSelect) this.videoInputSelect.appendChild(option);
        }
      });

      // Manejo de estados sin permisos o sin dispositivos detectados
      if (audioInCount === 0 && this.audioInputSelect) {
        this.audioInputSelect.innerHTML = '<option value="">Micrófono predeterminado (Permisos)</option>';
      }
      if (audioOutCount === 0 && this.audioOutputSelect) {
        this.audioOutputSelect.innerHTML = '<option value="">Bocina predeterminada del sistema</option>';
      }
      if (videoInCount === 0 && this.videoInputSelect) {
        this.videoInputSelect.innerHTML = '<option value="">Cámara web predeterminada</option>';
      }

    } catch (err) {
      console.error("Error al enumerar dispositivos:", err);
    }
  }

  // Visualizador dinámico de audio (Vúmetro con puntos o barras de la Imagen 2)
  async startAudioMeter(deviceId = null) {
    try {
      if (this.audioStream) {
        this.audioStream.getTracks().forEach(t => t.stop());
      }
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
      }

      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      };

      this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.audioStream);
      
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength; // 0 to 255
        
        // Modificar los puntos indicadores según el volumen detectado
        if (this.audioMeterDots && this.audioMeterDots.length >= 3) {
          const scale1 = 1 + Math.min(average / 40, 1.8);
          const scale2 = 1 + Math.min(average / 30, 2.2);
          const scale3 = 1 + Math.min(average / 50, 1.6);
          
          this.audioMeterDots[0].style.transform = `scale(${scale1})`;
          this.audioMeterDots[1].style.transform = `scale(${scale2})`;
          this.audioMeterDots[2].style.transform = `scale(${scale3})`;
        }

        this.animationFrameId = requestAnimationFrame(updateMeter);
      };

      updateMeter();

    } catch (err) {
      console.warn("No se pudo iniciar el medidor de voz:", err);
    }
  }

  stopAudioMeter() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(t => t.stop());
      this.audioStream = null;
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.audioMeterDots) {
      this.audioMeterDots.forEach(dot => dot.style.transform = 'scale(1)');
    }
  }

  // Prueba de sonido para las bocinas (Sonido armónico agradable)
  playTestSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      
      const now = ctx.currentTime;
      // Secuencia de 3 notas armoniosas (Do - Mi - Sol) tipo notificación Google Meet
      const freqs = [523.25, 659.25, 783.99, 1046.50];
      
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + (idx * 0.12));
        
        gain.gain.setValueAtTime(0, now + (idx * 0.12));
        gain.gain.linearRampToValueAtTime(0.2, now + (idx * 0.12) + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (idx * 0.12) + 0.35);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(now + (idx * 0.12));
        osc.stop(now + (idx * 0.12) + 0.4);
      });

      if (this.testSpeakerBtn) {
        const origText = this.testSpeakerBtn.innerText;
        this.testSpeakerBtn.innerText = "Sonando...";
        setTimeout(() => {
          this.testSpeakerBtn.innerText = origText;
        }, 1200);
      }
    } catch (e) {
      console.error("Error al reproducir tono de prueba:", e);
    }
  }

  // Previsualización de video dentro del modal de configuración
  async startCameraPreview(deviceId = null) {
    if (!this.videoPreview) return;

    try {
      if (this.videoStream) {
        this.videoStream.getTracks().forEach(t => t.stop());
      }

      const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false
      };

      this.videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoPreview.srcObject = this.videoStream;
      this.videoPreview.style.display = 'block';
      if (this.videoPlaceholder) this.videoPlaceholder.style.display = 'none';

    } catch (err) {
      console.warn("No se pudo iniciar la cámara en el modal:", err);
      if (this.videoPreview) this.videoPreview.style.display = 'none';
      if (this.videoPlaceholder) {
        this.videoPlaceholder.style.display = 'flex';
        this.videoPlaceholder.innerHTML = '<span>⚠️ Permiso de cámara no concedido</span>';
      }
    }
  }

  stopCameraPreview() {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(t => t.stop());
      this.videoStream = null;
    }
    if (this.videoPreview) {
      this.videoPreview.srcObject = null;
      this.videoPreview.style.display = 'none';
    }
    if (this.videoPlaceholder) {
      this.videoPlaceholder.style.display = 'flex';
    }
  }
}

// Instancia global
window.deviceManager = new DeviceManager();
