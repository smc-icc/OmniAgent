CREATE TABLE IF NOT EXISTS t_omni_access_scope (
  VDNID INT NOT NULL,
  OwnerType INT NOT NULL,
  OwnerId INT NOT NULL,
  PowerId INT NOT NULL,
  ScopeType VARCHAR(16) NOT NULL,
  PRIMARY KEY (VDNID, OwnerType, OwnerId, PowerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
