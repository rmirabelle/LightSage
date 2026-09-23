// Only verified Govee product identities select manufacturer-derived artwork.
const photos = new Map([
  ['H6013', '/bulb-h6013.png'],
  ['H6006', '/bulb-h6006.png'],
]);
const models = new Map([[24595, 'H6013'], [24582, 'H6006']]);
export function bulbPhoto(light) {
  // H6159 enrollment verifies its Bluetooth advertisement before saving it.
  if (light.transport === 'bluetooth' && light.model === 'H6159') return '/bulb-h6159.png';
  if (light.vendorId !== 4999) return null;
  const model = typeof light.model === 'string' ? light.model.trim().toUpperCase() : '';
  return photos.get(model) ?? (!model ? photos.get(models.get(light.productId)) : null) ?? null;
}
