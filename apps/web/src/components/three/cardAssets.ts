/**
 * Shared GPU assets for cards: one texture (the atlas), one material and one
 * small geometry per motif. Every card mesh reuses these, which keeps the
 * scene cheap enough for older phones.
 *
 * The texture follows the chosen card theme: its canvas gets the painted
 * atlas at once and the theme's image atlas as soon as it has loaded.
 */
import * as THREE from 'three';
import { ATLAS_SIZE, BACK_CELL, CELL_H, CELL_W, cellOf, getAtlasCanvas } from '@/lib/cardArt';
import { type CardThemeId, cardTheme, useCardTheme } from '@/lib/cardThemes';
import { CARD_H, CARD_THICK, CARD_W } from '@/lib/tableModel';

let texture: THREE.CanvasTexture | null = null;
let material: THREE.MeshStandardMaterial | null = null;
const geometries = new Map<number, THREE.BufferGeometry>();
let canvas: HTMLCanvasElement | null = null;
let shown: CardThemeId | null = null;
const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${url}`));
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

function paint(source: CanvasImageSource) {
  const ctx = canvas?.getContext('2d');
  if (!ctx || !texture) return;
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  ctx.drawImage(source, 0, 0, ATLAS_SIZE, ATLAS_SIZE);
  texture.needsUpdate = true;
}

function showTheme(id: CardThemeId) {
  if (!texture || shown === id) return;
  shown = id;
  const url = cardTheme(id).atlas;
  if (!url) {
    paint(getAtlasCanvas());
    return;
  }
  loadImage(url)
    .then((img) => {
      if (shown === id) paint(img);
    })
    .catch(() => {
      // Keep whatever is shown; the painted deck is always there.
    });
}

export function cardTexture(maxAnisotropy = 4): THREE.CanvasTexture {
  if (!texture) {
    canvas = document.createElement('canvas');
    canvas.width = ATLAS_SIZE;
    canvas.height = ATLAS_SIZE;
    canvas.getContext('2d')?.drawImage(getAtlasCanvas(), 0, 0);
    shown = 'standard';
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, maxAnisotropy);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    showTheme(useCardTheme.getState().theme);
    useCardTheme.subscribe((s) => showTheme(s.theme));
  }
  return texture;
}

export function cardMaterial(maxAnisotropy?: number): THREE.MeshStandardMaterial {
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      map: cardTexture(maxAnisotropy),
      alphaTest: 0.5,
      roughness: 0.62,
      metalness: 0,
      side: THREE.FrontSide,
    });
  }
  return material;
}

function uvRect(cell: number): [number, number, number, number] {
  const { col, row } = cellOf(cell);
  const inset = 1.5;
  const u0 = (col * CELL_W + inset) / ATLAS_SIZE;
  const u1 = ((col + 1) * CELL_W - inset) / ATLAS_SIZE;
  // Canvas textures are flipped so v = 1 is the top of the canvas.
  const v1 = 1 - (row * CELL_H + inset) / ATLAS_SIZE;
  const v0 = 1 - ((row + 1) * CELL_H - inset) / ATLAS_SIZE;
  return [u0, v0, u1, v1];
}

/**
 * A card lying flat: the face quad looks up (+Y) with the card's top edge
 * pointing away from the viewer (-Z), the back quad looks down. `cell` is the
 * face motif; face-down cards whose face must stay secret use BACK_CELL on
 * both sides.
 */
export function cardGeometry(cell: number): THREE.BufferGeometry {
  let geo = geometries.get(cell);
  if (geo) return geo;
  const w = CARD_W / 2;
  const h = CARD_H / 2;
  const t = CARD_THICK / 2;
  const [fu0, fv0, fu1, fv1] = uvRect(cell);
  const [bu0, bv0, bu1, bv1] = uvRect(BACK_CELL);
  // prettier-ignore
  const positions = new Float32Array([
    // front (+Y)
    -w, t, h,   w, t, h,   w, t, -h,   -w, t, -h,
    // back (-Y), mirrored so it reads correctly when flipped around Z
    w, -t, h,   -w, -t, h,   -w, -t, -h,   w, -t, -h,
  ]);
  // prettier-ignore
  const normals = new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
  ]);
  // prettier-ignore
  const uvs = new Float32Array([
    fu0, fv0, fu1, fv0, fu1, fv1, fu0, fv1,
    bu0, bv0, bu1, bv0, bu1, bv1, bu0, bv1,
  ]);
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geo.computeBoundingSphere();
  geometries.set(cell, geo);
  return geo;
}
