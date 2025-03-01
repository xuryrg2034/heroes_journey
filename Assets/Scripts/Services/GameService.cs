using System;
using Core.Entities;
using Cysharp.Threading.Tasks;
using Grid;
using Services.Abilities;
using Services.Grid;
using Services.Quest;
using Services.UI;
using UnityEngine;
using UnityEngine.Events;

namespace Services
{
    public enum GameState
    {
        TurnInProcess,
        PlayerTurn,
        EnemyTurn,
        WaitingForInput,
        UpdateGrid,
        Finish,
        QuestCheck,
    }
    
    public class GameService : MonoBehaviour
    {
        [SerializeField] private GridService gridService;
        [SerializeField] private GameObject abilitiesService;
        [SerializeField] private GameObject questService;
        [SerializeField] private HeroUIService heroUIService;
        [SerializeField] private Hero heroPrefab;
        [SerializeField] private Cell heroCellSpawn;

        private Hero _heroEntity;
        
        public static UnityEvent<GameState> OnGameStateChange = new();
        public static GameState CurrentState { get; private set; } = GameState.WaitingForInput;
        public static GameService Instance;
        
        private void Awake() {
            if (Instance == null) {
                Instance = this;
                DontDestroyOnLoad(gameObject);
            } else {
                Destroy(gameObject);
            }
        }

        private void Start()
        {
            _prepareGrid();
            _prepareAbilities();
            _prepareHeroUI();
            // _prepareQuests();
        }

        public static void SetGameState(GameState state)
        {
            CurrentState = state;
            OnGameStateChange?.Invoke(CurrentState);
        }

        private void _prepareAbilities()
        {
            var service = abilitiesService.GetComponent<AbilitiesService>();
            var ui = abilitiesService.GetComponent<AbilitiesUIService>();

            service.Init(_heroEntity.Abilities);
            ui.Init(service);
        }
        
        private void _prepareQuests()
        {
            var service = questService.GetComponent<QuestService>();
            var ui = questService.GetComponent<QuestUIService>();

            service.Init();
            ui.Init(service);
        }

        private void _prepareGrid()
        {
            gridService.Init();
            gridService.SpawnEntity(heroPrefab, heroCellSpawn);
            gridService.SpawnEntitiesOnGrid();

            _heroEntity = gridService.GetEntitiesOfType<Hero>()[0];
        }

        private void _prepareHeroUI()
        {
            heroUIService.Init(_heroEntity);
        }
    }
}