using System;
using Core.Entities;
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
        [SerializeField] private Hero selectedHero;

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
            gridService.Init();
            
            _prepareAbilities();
            _prepareQuests();
        }

        public static void SetGameState(GameState state)
        {
            CurrentState = state;
            Debug.Log(CurrentState);
            OnGameStateChange?.Invoke(CurrentState);
        }

        private void _prepareAbilities()
        {
            var service = abilitiesService.GetComponent<AbilitiesService>();
            var ui = abilitiesService.GetComponent<AbilitiesUIService>();

            service.Init(selectedHero.GetAbilities());
            ui.Init(service);
        }
        
        private void _prepareQuests()
        {
            var service = questService.GetComponent<QuestService>();
            var ui = questService.GetComponent<QuestUIService>();

            service.Init();
            ui.Init(service);
        }
    }
}