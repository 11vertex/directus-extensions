import { defineModule } from "@directus/extensions-sdk";
import ModuleComponent from "./module.vue";
var index_default = defineModule({
  id: "permission-simulator",
  name: "Permission Simulator",
  icon: "security",
  routes: [
    {
      path: "",
      component: ModuleComponent
    }
  ],
  preRegisterCheck(user) {
    return user?.admin_access === true;
  }
});
export {
  index_default as default
};
