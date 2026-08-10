/// <reference types="vite/client" />

import type { TeamRentalApi } from "../../shared/contracts";

declare global {
  interface Window {
    teamRental: TeamRentalApi;
  }
}

export {};

