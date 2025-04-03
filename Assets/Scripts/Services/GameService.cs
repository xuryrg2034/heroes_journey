using System;
using Entities.Player;
using Grid;
using Quests;
using Services.EventBus;
using Services.Turn;
using UnityEngine;
using UnityEngine.Tilemaps;

namespace Services
{
    public class GameService : MonoBehaviour
    {
        [Header("Tilemaps")]
        [SerializeField] Tilemap groundTilemap;
        [SerializeField] Tilemap obstacleTilemap;

        [Header("Services")]
        [SerializeField] AbilitiesUIService abilitiesUIService;
        [SerializeField] GameObject questService;
        [SerializeField] HeroUIService heroUIService;
        [SerializeField] TurnService turnService;
        [SerializeField] Hero heroPrefab;

        Hero _hero;
        
        public static GameState GameState { get; private set; }

        void OnDisable()
        {
            UnsubscribeEvents();
        }

        void Awake()
        {
            SubscribeEvents();
            RegisterServices();
            GridInitialize();
            AbilitiesInitialize();
            QuestsInitialize();
            TurnServiceInitialize();
            
            GameState = GameState.Idle;
        }

        void RegisterServices()
        {
            var spawnService = new SpawnService();
            var levelStatistics = new LevelStatistics();
            var gridService = new GridService(groundTilemap, obstacleTilemap, spawnService);
            
            ServiceLocator.Register(spawnService);
            ServiceLocator.Register(levelStatistics);
            ServiceLocator.Register(gridService);
        }

        void AbilitiesInitialize()
        {
            var abilitiesService = new AbilitiesService(_hero);
            ServiceLocator.Register(abilitiesService);
        }
        
        void QuestsInitialize()
        {
            var service = questService.GetComponent<QuestService>();
            var ui = questService.GetComponent<QuestUIService>();

            service.Init();
            ui.Init(service);
        }

        void GridInitialize()
        {
            var spawnService = ServiceLocator.Get<SpawnService>();
            var gridService = ServiceLocator.Get<GridService>();
            _hero = spawnService.SpawnHero(heroPrefab);
            
            gridService.SpawnEntitiesOnGrid();
            
            heroUIService.Init(_hero);
        }

        void TurnServiceInitialize()
        {
            turnService.Init();
        }

        void SubscribeEvents()
        {
            EventBusService.Subscribe<GameState>(GameEvents.GameStateChanged, ChangeGameState);
        }

        void UnsubscribeEvents()
        {
            EventBusService.Unsubscribe<GameState>(GameEvents.GameStateChanged, ChangeGameState);
        }

        void ChangeGameState(GameState newState)
        {
            GameState = newState;
        }
    }
}