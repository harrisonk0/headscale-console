package main
import("context";"encoding/json";"fmt";"net/http";"net/url";"os";"time";"tailscale.com/control/controlhttp";"tailscale.com/tailcfg";"tailscale.com/types/key")
func main(){
 if len(os.Args)!=2 {panic("Provide a public HTTPS URL")};u,err:=url.Parse(os.Args[1]);if err!=nil||u.Scheme!="https" {panic("An HTTPS URL is required")}
 ctx,cancel:=context.WithTimeout(context.Background(),25*time.Second);defer cancel()
 req,_:=http.NewRequestWithContext(ctx,"GET",u.String()+fmt.Sprintf("/key?v=%d",tailcfg.CurrentCapabilityVersion),nil)
 resp,err:=http.DefaultClient.Do(req);if err!=nil {panic(err)};defer resp.Body.Close();if resp.StatusCode!=200 {panic(fmt.Sprintf("Public key lookup returned %d",resp.StatusCode))}
 var keys struct{PublicKey key.MachinePublic `json:"publicKey"`};if err=json.NewDecoder(resp.Body).Decode(&keys);err!=nil {panic(err)};if keys.PublicKey.IsZero(){panic("Missing control public key")}
 d:=controlhttp.Dialer{Hostname:u.Hostname(),HTTPSPort:u.Port(),MachineKey:key.NewMachine(),ControlKey:keys.PublicKey,ProtocolVersion:uint16(tailcfg.CurrentCapabilityVersion)}
 conn,err:=d.Dial(ctx);if err!=nil {panic(err)};defer conn.Close()
 fmt.Printf("Native Tailscale HTTP upgrade and authenticated Noise handshake passed (%s). No registration request sent.\n",u.Host)
}
