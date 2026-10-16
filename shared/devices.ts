import type { WireScreen } from './schema.js';

export const wireDevices: Record<WireScreen['device'], {label:string; width:number; height:number}> = {
  desktop: {label:'Desktop',width:1440,height:900},
  tablet: {label:'Tablet',width:768,height:1024},
  mobile: {label:'Mobile',width:390,height:844},
};
