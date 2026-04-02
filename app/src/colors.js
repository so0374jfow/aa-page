import * as THREE from 'three';

export const STATUS_COLORS = {
  SCOUTED:        0x666666,
  ASSESSED:       0x888888,
  PENDING_REVIEW: 0xddcc33,
  APPROVED:       0x88cc44,
  NEGOTIATING:    0xdd8833,
  PURCHASED:      0x44aa44,
  SHIPPED:        0x44aa88,
  RECEIVED:       0x4488bb,
  ALLOCATED:      0x8855bb,
  INSTALLED:      null, // uses category colour
  REJECTED:       0x1a1a1a
};

export const CATEGORY_COLORS = {
  'CAT-A': 0xcc6633, // terracotta orange
  'CAT-B': 0x5588aa, // steel blue
  'CAT-C': 0x338888, // teal
  'CAT-D': 0xcc9933, // amber
  'CAT-E': 0xc4a96a  // warm sand
};

export const EMPTY_COLOR = 0xcccccc;
export const VIOLATION_COLOR = 0xff0000;
export const EDGE_COLOR = 0x333333;

export function getElementColor(element) {
  if (!element) return EMPTY_COLOR;
  if (element.status === 'INSTALLED') {
    return CATEGORY_COLORS[element.category] || 0x666666;
  }
  return STATUS_COLORS[element.status] || 0x666666;
}

export function colorToThree(hex) {
  return new THREE.Color(hex);
}
