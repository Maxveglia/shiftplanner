// The "Photo" part of the dish dialog. The field itself -- pick, reduce,
// preview, change, remove, nothing sent until Save -- is the one the stock's
// products use too (components/photo/PhotoField.tsx); a dish's speaks of the
// dish ("menu.photo.*").

import type { ComponentProps } from 'react';
import { PhotoField } from '../photo/PhotoField';

export function DishPhotoField(props: Omit<ComponentProps<typeof PhotoField>, 'messages'>) {
  return <PhotoField messages="menu.photo" {...props} />;
}
