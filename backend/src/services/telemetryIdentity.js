// Aircraft state and gateway state share topics; a state timestamp is not gateway identity.
function isGatewayOsd(sn,data,devices,gateways){
 if(devices[sn]||data.attitude_head!==undefined||data.attitude_pitch!==undefined)return false;
 return Boolean(gateways[sn])||data.app_version!==undefined;
}
module.exports={isGatewayOsd};
