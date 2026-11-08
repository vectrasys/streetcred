// Единый axios для бандла Worker (wrangler [alias]): toolkit PayPal и наш код
// получают один экземпляр. В Workers fetch не знает cache: 'default', которую
// axios ставит по умолчанию, поэтому — 'no-store'.
import axios from '../node_modules/axios/index.js';

axios.defaults.fetchOptions = { ...(axios.defaults.fetchOptions || {}), cache: 'no-store' };
export default axios;
export * from '../node_modules/axios/index.js';
