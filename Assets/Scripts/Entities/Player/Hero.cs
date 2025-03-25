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
        [SerializeField] private int damage;
        [SerializeField] private int energy;
        [SerializeField] private Animator animator;
        
        private List<BaseAbility> _abilities = new();

        private bool _isInit;
        
        private AbilityStateMachine _abilityStateMachine;

        private AbilitiesService _abilitiesService;
        
        public Animator Animator => animator;
        
        public AbilitiesService AbilitiesService => _abilitiesService;
        
        public Damage Damage { get; private set; }

        public Energy Energy { get; private set; }

        private void OnDisable()
        {
            _unsubscribeOnEvents();
        }

        public void Start()
        {
            _abilityStateMachine = GetComponent<AbilityStateMachine>();
        }

        private void Update()
        {
            if (!_isInit) return;

            if (_abilityStateMachine.CurrentState.GetType() == typeof(AbilityIdleState))
            {
                if (_abilitiesService.SelectedAbility)
                {
                    _abilityStateMachine.SetNextState(_abilitiesService.SelectedAbility.InitState);
                }
            }
            // if (Input.GetMouseButton(0) && _actionStateMachine.CurrentState.GetType() == typeof(IdleState))
            // {
            //     // var activeAbility = abilities.
            //     // _actionStateMachine.SetNextState(new GroundEntryState());
            // }
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

            _subscribeOnEvents();

            _isInit = true;
        }
        
        private void _restoreEnergy(int value = 1)
        {
            Energy.Increase(value);
        }

        private void _subscribeOnEvents()
        {
            EventBusService.Subscribe(Actions.PlayerTurnStart, _turnStart);
            EventBusService.Subscribe<int>(Actions.PlayerRestoreEnergy, _restoreEnergy);
        }
        
        private void _unsubscribeOnEvents()
        {
            EventBusService.Unsubscribe(Actions.PlayerTurnStart, _turnStart);
            EventBusService.Unsubscribe<int>(Actions.PlayerRestoreEnergy, _restoreEnergy);
        }

        private void _turnStart()
        {
            Energy.Increase();
        }
    }
}