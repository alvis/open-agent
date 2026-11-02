import esm from '@presetter/preset-esm';
import react from '@presetter/preset-react';
import strict from '@presetter/preset-strict';

import { preset } from 'presetter';

export default preset('open-agent', {
  extends: [esm, strict, react],
});
