describe('main bootstrap', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.PORT;
  });

  it('creates the Nest app with validation pipe, CORS and default port', async () => {
    const listen = jest.fn().mockResolvedValue(undefined);
    const enableCors = jest.fn();
    const useGlobalPipes = jest.fn();
    const create = jest.fn().mockResolvedValue({
      useGlobalPipes,
      enableCors,
      listen,
    });

    jest.doMock('@nestjs/core', () => ({
      NestFactory: { create },
    }));

    jest.isolateModules(() => {
      require('./main');
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(create).toHaveBeenCalledTimes(1);
    expect(useGlobalPipes).toHaveBeenCalledTimes(1);
    expect(enableCors).toHaveBeenCalledWith({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
    expect(listen).toHaveBeenCalledWith(3000);
  });

  it('uses PORT when it is present in the environment', async () => {
    process.env.PORT = '4100';
    const listen = jest.fn().mockResolvedValue(undefined);

    jest.doMock('@nestjs/core', () => ({
      NestFactory: {
        create: jest.fn().mockResolvedValue({
          useGlobalPipes: jest.fn(),
          enableCors: jest.fn(),
          listen,
        }),
      },
    }));

    jest.isolateModules(() => {
      require('./main');
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(listen).toHaveBeenCalledWith('4100');
  });
});
