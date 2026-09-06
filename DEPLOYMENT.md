# 🚀 Guía de Despliegue en Producción y Configuración de VPN

Esta guía detalla paso a paso cómo desplegar **TeleMeet** en un servidor de producción (VPS Linux: Ubuntu 22.04 / 24.04, Debian, etc.), habilitar HTTPS (obligatorio para acceso a cámara y micrófono) y configurar el túnel seguro VPN.

---

## 📋 1. Requisitos Previos

- Un servidor VPS con Linux (Ubuntu 22.04 LTS recomendado).
- Un nombre de dominio apuntando a la IP pública de tu servidor (ej. `meet.tudominio.com`).
- Puertos abiertos en el firewall del servidor:
  - `80/TCP` (HTTP para renovación SSL)
  - `443/TCP` (HTTPS para la aplicación)
  - `1194/UDP` o `51820/UDP` (Si vas a levantar servidor OpenVPN o WireGuard en el mismo VPS)

---

## 🛠️ 2. Instalación y Configuración en el Servidor Linux

### Paso 2.1: Actualizar el sistema e instalar paquetes base
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-pip python3-venv nginx certbot python3-certbot-nginx git
```

### Paso 2.2: Clonar el repositorio y crear entorno virtual
```bash
cd /var/www
sudo git clone <URL_DE_TU_REPOSITORIO> telemeet
sudo chown -R $USER:$USER /var/www/telemeet
cd /var/www/telemeet/videoconferencia

# Crear y activar entorno virtual
python3 -m venv venv
source venv/bin/activate

# Instalar dependencias
pip install -r requirements.txt
```

### Paso 2.3: Configurar variables de entorno (`.env`)
Crea el archivo `.env` en la raíz del proyecto (`/var/www/telemeet/videoconferencia/.env`):
```bash
nano .env
```
Pega el siguiente contenido ajustando tus datos reales:
```ini
DJANGO_SECRET_KEY=genera-una-clave-secreta-larga-y-aleatoria
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=meet.tudominio.com,127.0.0.1,10.8.0.1
DJANGO_CSRF_TRUSTED_ORIGINS=https://meet.tudominio.com

# Configuración VPN (ajusta según tu subred de VPN)
VPN_SERVER_IP=10.8.0.1
VPN_SUBNET_PREFIX=10.8.0.
VPN_SERVER_NAME=Servidor-Central-VPN
VPN_ENFORCE=False
```

### Paso 2.4: Migraciones y recopilación de estáticos
```bash
python manage.py migrate
python manage.py createsuperuser
python manage.py collectstatic --noinput
```

---

## ⚙️ 3. Configurar Gunicorn y Systemd

Crea el archivo de servicio de systemd para que Django se ejecute en segundo plano y se reinicie automáticamente:
```bash
sudo nano /etc/systemd/system/telemeet.service
```
Contenido:
```ini
[Unit]
Description=TeleMeet Videoconferencia Gunicorn Daemon
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/telemeet/videoconferencia
ExecStart=/var/www/telemeet/videoconferencia/venv/bin/gunicorn \
          --workers 3 \
          --bind 127.0.0.1:8000 \
          core.wsgi:application

[Install]
WantedBy=multi-user.target
```

Ajusta permisos, habilita e inicia el servicio:
```bash
sudo chown -R www-data:www-data /var/www/telemeet
sudo systemctl daemon-reload
sudo systemctl start telemeet
sudo systemctl enable telemeet
sudo systemctl status telemeet
```

---

## 🌐 4. Configurar Nginx y Certificado SSL (HTTPS)

> [!IMPORTANT]
> **HTTPS es obligatorio:** Los navegadores (Chrome, Edge, Firefox, Safari) bloquean la cámara, micrófono (`getUserMedia`) y pantalla compartida en conexiones remotas que no tengan SSL/HTTPS.

### Paso 4.1: Crear configuración de Nginx
```bash
sudo nano /etc/nginx/sites-available/telemeet
```
Contenido:
```nginx
server {
    server_name meet.tudominio.com;

    location /static/ {
        alias /var/www/telemeet/videoconferencia/staticfiles/;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Habilitar el sitio:
```bash
sudo ln -s /etc/nginx/sites-available/telemeet /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Paso 4.2: Obtener certificado SSL gratis con Certbot
```bash
sudo certbot --nginx -d meet.tudominio.com
```
Certbot configurará automáticamente la renovación periódica y el cifrado HTTPS TLS 1.3.

---

## 🔒 5. Configuración del Servidor VPN (Opcional / Recomendado)

Si deseas que los usuarios se conecten exclusivamente mediante un túnel privado cifrado:

### Opción A: WireGuard (Rápido y Moderno)
1. Instalar script automatizado en el VPS:
   ```bash
   wget https://git.io/wireguard-install -O wireguard-install.sh && bash wireguard-install.sh
   ```
2. Genera perfiles de cliente `.conf` o códigos QR para que los usuarios los carguen en su cliente WireGuard.
3. Al conectarse, la IP del cliente pasará a ser `10.8.0.x` (o la subred configurada), y TeleMeet mostrará el badge verde **"Túnel VPN Seguro Conectado"**.

### Opción B: OpenVPN
1. Instalar con script automatizado:
   ```bash
   wget https://git.io/vpn -O openvpn-install.sh && bash openvpn-install.sh
   ```
2. Generar archivos `.ovpn` para los participantes.

---

## 📱 6. Cómo se Conectan los Usuarios

1. **Paso 1:** El usuario ingresa a `https://meet.tudominio.com/` e inicia sesión o se registra.
2. **Paso 2:** El anfitrión crea una reunión instantánea o programada y comparte el enlace (ej: `https://meet.tudominio.com/room/abc-defg-hij/`).
3. **Paso 3:** Los demás participantes abren el enlace. Entran a la sala de espera.
4. **Paso 4:** El anfitrión recibe la notificación en tiempo real y presiona **"Permitir"**.
5. **Paso 5:** Automáticamente se establece la conexión WebRTC: ambas cámaras/micrófonos se transmiten en vivo, el chat se sincroniza al instante y pueden compartir pantalla.
