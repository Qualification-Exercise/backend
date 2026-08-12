export interface IAuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  };
}

export interface IJwtPayload {
  sub: string;
  userId: string;
  email?: string;
  type?: 'refresh';
  jti?: string;
  familyId?: string;
}
