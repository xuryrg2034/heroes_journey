using System;
using System.Collections.Generic;
using System.Linq;
using Entities.Components;
using UnityEngine;
using Services.EventBus;

namespace Entities.Player
{
    public class Hero : BaseEntity
    {
        [SerializeField] int damage;
        [SerializeField] int energy;
        [SerializeField] Animator animator;
        
        List<BaseAbility> _abilities = new();

        bool _isInit;
        
        AbilityStateMachine _abilityStateMachine;

        AbilitiesService _abilitiesService;
        
        public Animator Animator => animator;
        
        public AbilitiesService AbilitiesService => _abilitiesService;
        
        public Damage Damage { get; private set; }

        public Energy Energy { get; private set; }

        private void OnDisable()
        {
            UnsubscribeOnEvents();
        }

        public void Start()
        {
            _abilityStateMachine = GetComponent<AbilityStateMachine>();
        }

        private void Update()
        {
            if (!_isInit) return;

            if (_abilityStateMachine.CurrentState is AbilityIdleState)
            {
                if (_abilitiesService.SelectedAbility)
                {
                    _abilityStateMachine.SetNextState(_abilitiesService.SelectedAbility.InitState);
                }
            }
        }

        public override void Init()
        {
            base.Init();

            _abilitiesService = GetComponent<AbilitiesService>();
            _abilities = GetComponents<BaseAbility>().ToList();
            
            _abilitiesService.Init(_abilities);

            Damage = new Damage(damage);
            Energy = new Energy(energy, energy);

            foreach (var ability in _abilities)
            {
                ability.Init(this);
            }

            SubscribeOnEvents();

            _isInit = true;
        }
        
        void RestoreEnergy(int value = 1)
        {
            Energy.Increase(value);
        }

        void SubscribeOnEvents()
        {
            EventBusService.Subscribe(Actions.PlayerTurnStart, TurnStart);
            EventBusService.Subscribe<int>(Actions.PlayerRestoreEnergy, RestoreEnergy);
        }
        
        void UnsubscribeOnEvents()
        {
            EventBusService.Unsubscribe(Actions.PlayerTurnStart, TurnStart);
            EventBusService.Unsubscribe<int>(Actions.PlayerRestoreEnergy, RestoreEnergy);
        }

        void TurnStart()
        {
            Energy.Increase();
        }
    }
}