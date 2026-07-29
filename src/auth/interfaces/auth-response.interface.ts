export interface IAuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

export interface IJwtPayload {
  sub: string;
  email?: string;
  type?: 'refresh';
}
