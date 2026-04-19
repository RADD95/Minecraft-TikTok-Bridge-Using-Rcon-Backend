# 🎮 
Sistema que conecta TikTok LIVE con Minecraft vía RCON. Reemplazo completo de TikFinity sin límites de acciones, con estadísticas acumulativas y múltiples comandos por evento.

## 🚀 Características

- ✅ Sin límites - Acciones ilimitadas (no como TikFinity con 5 gratis)
- ✅ Estadísticas acumulativas - Contadores de likes, comentarios, regalos y follows
- ✅ Múltiples comandos - Un evento puede ejecutar varios comandos (separados por línea o `;`)
- ✅ Variables dinámicas - Motor de templates con 15+ variables disponibles
- ✅ Panel web intuitivo - Configuración visual sin editar archivos JSON
- ✅ Persistencia - Configuración y acciones se guardan automáticamente

## 🛠️ Instalación

### Requisitos previos

- Node.js 16+ instalado
- Servidor Minecraft con RCON habilitado
- Cuenta de TikTok (para hacer LIVE)

### Pasos de instalación

1. Instalar dependencias necesarias:
```bash
npm install express cors rcon-client tiktok-live-connector
```

### Configuración de Minecraft (RCON)

#### Para servidores dedicados (`server.properties`):
```
enable-rcon=true
rcon.password=tu_password_seguro
rcon.port=tu_puerto_rcon
```

#### Para Singleplayer (mundo LAN):
- Instalar mod RCON o Simple RCON (Fabric/Forge)
- Configurar puerto y password
- Abrir mundo a LAN

## 🖥️ Uso del Sistema

1. Iniciar el servidor:
```bash
npm start
```

2. Abrir panel web: [http://localhost:4567](http://localhost:4567)

3. Configurar RCON (IP, puerto y password), guardar y conectar.

4. Configurar jugador en Minecraft (`{{playername}}`).

5. Crear acciones según tipo de evento: Gift, Comment, Like, Follow. Configurar triggers y comandos.

6. Iniciar TikTok LIVE, ingresar usuario, y conectar.

## 🎯 Variables Disponibles

- Variables en tiempo real: `{{username}}`, `{{nickname}}`, `{{giftname}}`, `{{repeatcount}}`, `{{likecount}}`, `{{comment}}`, `{{playername}}`, `{{diamondcount}}`
- Contadores acumulados: `{{totallikes}}`, `{{totalcomments}}`, `{{totalfollows}}`, `{{totalgifts}}`, `{{totaldiamonds}}`, `{{userlikes}}`, `{{usercomments}}`, `{{usergifts}}`, `{{userfollows}}`

## 📝 Ejemplos de Acciones

En el campo “Comando Minecraft” puedes escribir uno o varios comandos.  
Cada comando va separado por `;` y es buena idea terminar siempre en `;` para seguir agregando más.

Básicos y avanzados, combinando comentarios, regalos, likes acumulados, títulos, subtítulos, partículas y sonidos.

## Comentario (cualquiera)
```bash
tellraw @a [{"text":"{{nickname}}","color":"#ff0050","bold":true},{"text":": ","color":"white"},{"text":"{{comment}}","color":"white"}];
```

# Regalo (cualquiera)
```bash
execute at {{playername}} run playsound minecraft:block.amethyst_block.chime master {{playername}} ~ ~ ~ 1 1;
execute at {{playername}} run playsound minecraft:block.amethyst_cluster.break master {{playername}} ~ ~ ~ 1 0.5;
execute at {{playername}} run playsound minecraft:entity.illusioner.cast_spell master {{playername}} ~ ~ ~ 1 1;
title {{playername}} title {"text":"{{nickname}}","color":"#ff0050","bold":true};
title {{playername}} subtitle {"text":"Envió {{giftname}} x{{repeatcount}}","color":"aqua"};
execute at {{playername}} run particle minecraft:flash ~ ~3 ~ 0 0 0 0 1;
execute at {{playername}} run particle minecraft:dust{color:[1,0,0],scale:2} ~ ~3 ~ 4 2 4 0 1000;
execute at {{playername}} run particle minecraft:dust{color:[0,1,1],scale:2} ~ ~3 ~ 4 2 4 0 1000;
execute at {{playername}} run particle minecraft:dust{color:[1,1,0],scale:2} ~ ~3 ~ 4 2 4 0 1000;
execute at {{playername}} run particle minecraft:dust{color:[1,0,1],scale:2} ~ ~3 ~ 4 2 4 0 1000;
execute at {{playername}} run particle minecraft:enchant ~ ~3 ~ 3 2 3 0.1 100;
execute at {{playername}} run particle minecraft:cherry_leaves ~ ~3 ~ 3 2 3 0.05 50;
```
# Likes acumulados (cada 100 por usuario)
```bash
execute at {{playername}} run playsound minecraft:entity.creeper.primed master {{playername}} ~ ~ ~ 1 1;
execute at {{playername}} run playsound minecraft:entity.generic.explode master {{playername}} ~ ~ ~ 1 1;
execute at {{playername}} run playsound minecraft:entity.creeper.death master {{playername}} ~ ~ ~ 1 0.5;
title {{playername}} title {"text":"{{nickname}}","color":"#ff0050","bold":true};
title {{playername}} subtitle {"text":"¡Envió {{userlikes}} Likes!","color":"gold","italic":true};
execute at {{playername}} run particle minecraft:flash ~ ~3 ~ 0 0 0 0 1;
execute at {{playername}} run particle minecraft:dust{color:[0,1,0],scale:2.5} ~ ~3 ~ 4 2 4 0 1200;
execute at {{playername}} run particle minecraft:dust{color:[0.1,0.4,0],scale:2.5} ~ ~3 ~ 4 2 4 0 1000;
execute at {{playername}} run particle minecraft:happy_villager ~ ~3 ~ 3 2 3 0.1 200;
execute at {{playername}} run particle minecraft:large_smoke ~ ~3 ~ 2 2 2 0.05 100;
```


## 🔧 API Endpoints

- `/api/status` GET - Estado
- `/api/config` GET/POST - Configuración
- `/api/actions` GET/POST - Acciones
- `/api/actions/:index` DELETE - Eliminar acción
- `/api/stats` GET - Ver estadísticas
- `/api/stats/reset` POST - Resetear estadísticas
- `/api/rcon/connect` POST - Conectar RCON
- `/api/rcon/disconnect` POST - Desconectar RCON
- `/api/rcon/test` POST - Test RCON
- `/api/rcon/command` POST - Comando manual
- `/api/tiktok/start` POST - Iniciar TikTok
- `/api/tiktok/stop` POST - Detener TikTok

## ⚠️ Solución de Problemas

- Error RCON: verificar IP, puerto, password, firewall
- No conecta TikTok LIVE: estar en vivo y nombre correcto
- Comandos no se ejecutan: RCON conectado, probar manual
- Likes aparecen como batch: usar `{{totallikes}}`

## 🔄 Reinicio y persistencia

- Archivos `config.json`, `actions.json`, `stats.json` creados automáticamente
- Reconexión RCON automática
- Estadísticas persistentes hasta reset

## 📜 Licencia

Eres libre de copiar, distribuir y modificar este software. Solo recuerda dar crédito al autor y, si haces mejoras geniales, ¡no te las guardes! Que el código siga siendo libre para todos.

