import { defineModule } from "@directus/extensions-sdk";
import ModuleComponent from "./module.vue";

export default defineModule({
  id: "flow-version-history",
  name: "Flow Version History",
  icon: "history",
  routes: [{ path: "", component: ModuleComponent }],
  preRegisterCheck(user) {
    return user?.admin_access === true;
  }
});
