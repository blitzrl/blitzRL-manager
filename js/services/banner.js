// ============================================================
// BANNER — Generación de banners de fichajes vía canvas
// ============================================================
import { getDB } from './storage.js';

export async function generateTransferBanner(player, fromTeam, toTeam){
  const bg = getDB().transferBannerBg || '';
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 500;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, 1200, 500);

  if (bg){
    try {
      const img = await loadImage(bg);
      ctx.globalAlpha = 0.7;
      ctx.drawImage(img, 0, 0, 1200, 500);
      ctx.globalAlpha = 1;
    } catch(_){}
  }

  const grad = ctx.createLinearGradient(0, 0, 1200, 0);
  grad.addColorStop(0, 'rgba(5,5,5,0.85)');
  grad.addColorStop(0.5, 'rgba(5,5,5,0.25)');
  grad.addColorStop(1, 'rgba(5,5,5,0.85)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 500);

  const [shL, shR] = await Promise.all([
    fromTeam?.logo ? loadImage(fromTeam.logo).catch(() => null) : null,
    toTeam?.logo   ? loadImage(toTeam.logo).catch(() => null)   : null
  ]);

  const cy = 210;
  if (shL) ctx.drawImage(shL, 130, cy - 80, 160, 160);
  else drawShieldPlaceholder(ctx, 130, cy - 80, 160, 160);
  if (shR) ctx.drawImage(shR, 910, cy - 80, 160, 160);
  else drawShieldPlaceholder(ctx, 910, cy - 80, 160, 160);

  // ✅ FIX: flecha apuntando a la DERECHA (origen → destino)
  ctx.fillStyle = '#E6C476';
  ctx.beginPath();
  ctx.moveTo(680, cy);            // punta derecha
  ctx.lineTo(560, cy - 32);       // diagonal superior
  ctx.lineTo(560, cy - 12);       // escalón superior
  ctx.lineTo(520, cy - 12);       // base superior
  ctx.lineTo(520, cy + 12);       // base inferior
  ctx.lineTo(560, cy + 12);       // escalón inferior
  ctx.lineTo(560, cy + 32);       // diagonal inferior
  ctx.closePath();
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#E8EAED';
  ctx.font = 'bold 42px Rajdhani, Inter, sans-serif';
  ctx.fillText((player.name || '?').toUpperCase(), 600, 400);

  ctx.fillStyle = '#8D929A';
  ctx.font = '600 18px Rajdhani, Inter, sans-serif';
  ctx.fillText('TRANSFER OFICIAL · ZENITH CHAMPIONSHIP', 600, 440);

  ctx.fillStyle = '#C7CBD1';
  ctx.font = 'bold 20px Rajdhani, Inter, sans-serif';
  ctx.fillText(fromTeam?.name || 'Libre', 210, cy + 130);
  ctx.fillText(toTeam?.name   || 'Libre', 990, cy + 130);

  return canvas.toDataURL('image/webp', 0.9);
}

export function loadImage(src){
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function drawShieldPlaceholder(ctx, x, y, w, h){
  ctx.fillStyle = 'rgba(20,20,30,0.9)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#25272B';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#8D929A';
  ctx.font = '40px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('◆', x + w/2, y + h/2 + 14);
}